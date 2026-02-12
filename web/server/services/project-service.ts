import { readdir, readFile, writeFile, copyFile, unlink, mkdir, stat } from 'fs/promises';
import { existsSync } from 'fs';
import { resolve, basename, dirname, join } from 'path';
import { ConfigSchema } from '../../../src/core/config.js';
import { IMAGE_METADATA_SCHEMA_VERSION } from '../../../src/core/image-metadata.js';
import { getErrorMessage } from '../../../src/core/errors.js';
import { log } from '../../../src/core/logger.js';
import {
  getProjectDirs,
  getBaselineDir,
  getOutputDir,
  getDiffDir,
  getAcceptancesPath,
  getImageMetadataPath,
  type PathConfig,
} from '../../../src/core/paths.js';

// ─── Server Info ─────────────────────────────────────────────────────────────

export interface ServerInfo {
  cwd: string;
  projectName: string;
  existingConfig: string | undefined;
  hasConfig: boolean;
}

const CONFIG_FILES = ['vrt.config.json', '.vrtrc.json'];

export function getServerInfo(): ServerInfo {
  const cwd = process.cwd();
  const existingConfig = CONFIG_FILES.find((f) => existsSync(resolve(cwd, f)));

  return {
    cwd,
    projectName: basename(cwd),
    existingConfig,
    hasConfig: !!existingConfig,
  };
}

// ─── Config Management ───────────────────────────────────────────────────────

export interface ConfigError {
  path: string;
  message: string;
}

function mapZodErrors(issues: { path: (string | number)[]; message: string }[]): ConfigError[] {
  return issues.map((issue) => ({
    path: issue.path.join('.'),
    message: issue.message,
  }));
}

export interface ConfigLoadResult {
  config: unknown;
  raw: unknown;
  valid: boolean;
  errors: ConfigError[] | null;
}

export async function loadConfig(
  projectPath: string,
  configFile: string
): Promise<ConfigLoadResult> {
  const configPath = resolve(projectPath, configFile);

  if (!existsSync(configPath)) {
    throw new Error(`Config file not found: ${configPath}`);
  }

  const content = await readFile(configPath, 'utf-8');
  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch {
    return {
      config: null,
      raw: null,
      valid: false,
      errors: [{ path: '', message: `Invalid JSON in config file: ${configPath}` }],
    };
  }
  const result = ConfigSchema.safeParse(raw);

  return {
    config: result.success ? result.data : raw,
    raw,
    valid: result.success,
    errors: result.success ? null : mapZodErrors(result.error.issues),
  };
}

export type ConfigSaveResult =
  | { success: true; config: unknown }
  | { success: false; errors: ConfigError[] };

export async function saveConfig(
  projectPath: string,
  configFile: string,
  config: unknown
): Promise<ConfigSaveResult> {
  const result = ConfigSchema.safeParse(config);

  if (!result.success) {
    return { success: false, errors: mapZodErrors(result.error.issues) };
  }

  const configPath = resolve(projectPath, configFile);
  await writeFile(configPath, JSON.stringify(result.data, null, 2));

  return { success: true, config: result.data };
}

export function getConfigSchemaInfo(): Record<string, string[]> {
  return {
    browsers: ['chromium', 'webkit'],
    waitForOptions: ['load', 'networkidle', 'domcontentloaded'],
    aiProviders: ['anthropic', 'openai', 'openrouter', 'google'],
    severityLevels: ['info', 'warning', 'critical'],
    changeCategories: ['cosmetic', 'noise', 'content_change', 'layout_shift', 'regression'],
    ruleActions: ['approve', 'flag', 'reject'],
  };
}

// ─── Acceptance Management ───────────────────────────────────────────────────

export interface AcceptanceMetrics {
  diffPercentage: number;
  pixelDiff?: number;
  ssimScore?: number;
  phash?: number;
}

export interface AcceptanceSignals {
  scenario?: string;
  viewport?: string;
  viewportWidth?: number;
  viewportHeight?: number;
  browserPair?: {
    baseline?: { name?: string; version?: string };
    test?: { name?: string; version?: string };
  };
}

export interface Acceptance {
  filename: string;
  acceptedAt: string;
  reason?: string;
  comparedAgainst: {
    filename: string;
    type: 'baseline' | 'test';
  };
  metrics: AcceptanceMetrics;
  signals?: AcceptanceSignals;
}

export interface AutoThresholdCap {
  scenario: string;
  viewport: string;
  sampleSize: number;
  p95DiffPercentage: number;
  p95PixelDiff?: number;
  pixelSampleSize?: number;
}

export interface AutoThresholdCaps {
  percentile: number;
  minSampleSize: number;
  caps: Record<string, AutoThresholdCap>;
}

interface AcceptancesFile {
  acceptances: Acceptance[];
}

export interface ImageFlag {
  filename: string;
  flaggedAt: string;
  reason?: string;
}

interface ImageFlagsFile {
  flags: ImageFlag[];
}

async function ensureAcceptancesDir(projectPath: string): Promise<string> {
  const filePath = getAcceptancesPath(projectPath);
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }
  return filePath;
}

export async function loadAcceptances(projectPath: string): Promise<Acceptance[]> {
  const filePath = await ensureAcceptancesDir(projectPath);
  if (!existsSync(filePath)) {
    return [];
  }
  try {
    const content = await readFile(filePath, 'utf-8');
    const data: AcceptancesFile = JSON.parse(content);
    return data.acceptances || [];
  } catch (err) {
    // Log parsing errors but return empty array to allow graceful degradation.
    // File corruption is recoverable by re-accepting images.
    log.warn(`Failed to load acceptances from ${filePath}:`, getErrorMessage(err));
    return [];
  }
}

export async function saveAcceptances(
  projectPath: string,
  acceptances: Acceptance[]
): Promise<void> {
  const filePath = await ensureAcceptancesDir(projectPath);
  const data: AcceptancesFile = { acceptances };
  await writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

export function acceptancesToMap(acceptances: Acceptance[]): Record<string, Acceptance> {
  const map: Record<string, Acceptance> = {};
  for (const a of acceptances) {
    map[a.filename] = a;
  }
  return map;
}

export async function createAcceptance(
  projectPath: string,
  acceptance: Omit<Acceptance, 'acceptedAt'>
): Promise<Acceptance> {
  const acceptances = await loadAcceptances(projectPath);
  const filtered = acceptances.filter((a) => a.filename !== acceptance.filename);

  const newAcceptance: Acceptance = {
    ...acceptance,
    acceptedAt: new Date().toISOString(),
  };

  filtered.push(newAcceptance);
  await saveAcceptances(projectPath, filtered);

  return newAcceptance;
}

export async function revokeAcceptance(projectPath: string, filename: string): Promise<boolean> {
  const acceptances = await loadAcceptances(projectPath);
  const filtered = acceptances.filter((a) => a.filename !== filename);

  if (filtered.length === acceptances.length) {
    return false;
  }

  await saveAcceptances(projectPath, filtered);
  return true;
}

function getImageFlagsPath(projectPath: string): string {
  return resolve(projectPath, '.vrt', 'acceptances', 'flags.json');
}

async function ensureImageFlagsPath(projectPath: string): Promise<string> {
  const path = getImageFlagsPath(projectPath);
  const dir = dirname(path);
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }
  return path;
}

export async function loadImageFlags(projectPath: string): Promise<ImageFlag[]> {
  const filePath = await ensureImageFlagsPath(projectPath);
  if (!existsSync(filePath)) {
    return [];
  }
  try {
    const content = await readFile(filePath, 'utf-8');
    const data: ImageFlagsFile = JSON.parse(content);
    return data.flags || [];
  } catch (err) {
    log.warn(`Failed to load image flags from ${filePath}:`, getErrorMessage(err));
    return [];
  }
}

export async function saveImageFlags(projectPath: string, flags: ImageFlag[]): Promise<void> {
  const filePath = await ensureImageFlagsPath(projectPath);
  const data: ImageFlagsFile = { flags };
  await writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

export function imageFlagsToMap(flags: ImageFlag[]): Record<string, ImageFlag> {
  const map: Record<string, ImageFlag> = {};
  for (const flag of flags) {
    map[flag.filename] = flag;
  }
  return map;
}

export async function setImageFlag(
  projectPath: string,
  flag: Omit<ImageFlag, 'flaggedAt'>
): Promise<ImageFlag> {
  const flags = await loadImageFlags(projectPath);
  const filtered = flags.filter((entry) => entry.filename !== flag.filename);

  const next: ImageFlag = {
    ...flag,
    flaggedAt: new Date().toISOString(),
  };

  filtered.push(next);
  await saveImageFlags(projectPath, filtered);
  return next;
}

export async function revokeImageFlag(projectPath: string, filename: string): Promise<boolean> {
  const flags = await loadImageFlags(projectPath);
  const filtered = flags.filter((entry) => entry.filename !== filename);

  if (filtered.length === flags.length) {
    return false;
  }

  await saveImageFlags(projectPath, filtered);
  return true;
}

// ─── Image Management ────────────────────────────────────────────────────────

/** Fallback value for unparseable filename components */
const UNKNOWN_COMPONENT = 'unknown';

export interface ImageMetadata {
  filename: string;
  scenario: string;
  browser: string;
  version?: string;
  viewport: string;
  /** Screenshot file mtime (ISO). */
  updatedAt?: string;
}

type ImageType = 'baseline' | 'test' | 'diff';

function getProjectImagePaths(projectPath: string, filename: string, config?: PathConfig) {
  const baselineDir = getBaselineDir(projectPath, config);
  const outputDir = getOutputDir(projectPath, config);
  const diffDir = getDiffDir(projectPath, config);
  return {
    baselineDir,
    outputDir,
    diffDir,
    testPath: resolve(outputDir, filename),
    baselinePath: resolve(baselineDir, filename),
    diffPath: resolve(diffDir, filename),
  };
}

export function parseImageFilename(filename: string): ImageMetadata {
  const name = filename.replace(/\.png$/, '');
  const parts = name.split('_');

  if (parts.length < 3) {
    return { filename, scenario: name, browser: UNKNOWN_COMPONENT, viewport: UNKNOWN_COMPONENT };
  }

  // The browser segment matches: chromium, webkit, chromium-v130, webkit-v17.4, etc.
  const browserPattern = /^(chromium|webkit)(?:-v(\d+(?:\.\d+)*))?$/i;

  // Search for the browser segment (may not be parts[1] for multi-underscore scenarios).
  for (let i = 1; i < parts.length - 1; i++) {
    const match = parts[i].match(browserPattern);
    if (match) {
      const scenario = parts.slice(0, i).join('_');
      const viewport = parts.slice(i + 1).join('_');
      return {
        filename,
        scenario,
        browser: match[1],
        version: match[2],
        viewport,
      };
    }
  }

  // Fallback: assume parts[0] is scenario, parts[1] is browser, rest is viewport
  return { filename, scenario: parts[0], browser: parts[1], viewport: parts.slice(2).join('_') };
}

const DEFAULT_AUTO_THRESHOLD_PERCENTILE = 0.95;
const DEFAULT_AUTO_THRESHOLD_MIN_SAMPLE = 5;

function percentileNearestRank(values: number[], percentile: number): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil(percentile * sorted.length);
  const index = Math.min(sorted.length - 1, Math.max(0, rank - 1));
  return sorted[index];
}

function normalizeGroupComponent(value?: string): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed || trimmed === UNKNOWN_COMPONENT) return undefined;
  return trimmed;
}

function getAcceptanceGroupKey(
  acceptance: Acceptance
): { key: string; scenario: string; viewport: string } | null {
  let scenario = normalizeGroupComponent(acceptance.signals?.scenario);
  let viewport = normalizeGroupComponent(acceptance.signals?.viewport);

  if (!scenario || !viewport) {
    const parsed = parseImageFilename(acceptance.filename);
    scenario = scenario ?? normalizeGroupComponent(parsed.scenario);
    viewport = viewport ?? normalizeGroupComponent(parsed.viewport);
  }

  if (!scenario || !viewport) return null;

  return { key: `${scenario}::${viewport}`, scenario, viewport };
}

export function computeAutoThresholdCaps(
  acceptances: Acceptance[],
  options: { percentile?: number; minSampleSize?: number } = {}
): AutoThresholdCaps {
  const percentile = options.percentile ?? DEFAULT_AUTO_THRESHOLD_PERCENTILE;
  const minSampleSize = options.minSampleSize ?? DEFAULT_AUTO_THRESHOLD_MIN_SAMPLE;
  const groups = new Map<
    string,
    {
      scenario: string;
      viewport: string;
      diffPercentages: number[];
      pixelDiffs: number[];
    }
  >();

  for (const acceptance of acceptances) {
    const groupKey = getAcceptanceGroupKey(acceptance);
    if (!groupKey) continue;
    const diffPercentage = acceptance.metrics.diffPercentage;
    if (!Number.isFinite(diffPercentage)) continue;

    const group =
      groups.get(groupKey.key) ??
      ({
        scenario: groupKey.scenario,
        viewport: groupKey.viewport,
        diffPercentages: [],
        pixelDiffs: [],
      } satisfies {
        scenario: string;
        viewport: string;
        diffPercentages: number[];
        pixelDiffs: number[];
      });

    group.diffPercentages.push(diffPercentage);

    const pixelDiff = acceptance.metrics.pixelDiff;
    if (typeof pixelDiff === 'number' && Number.isFinite(pixelDiff)) {
      group.pixelDiffs.push(pixelDiff);
    }

    groups.set(groupKey.key, group);
  }

  const caps: Record<string, AutoThresholdCap> = {};

  for (const [key, group] of groups) {
    if (group.diffPercentages.length < minSampleSize) continue;

    const p95DiffPercentage = percentileNearestRank(group.diffPercentages, percentile);
    if (p95DiffPercentage === undefined) continue;

    const cap: AutoThresholdCap = {
      scenario: group.scenario,
      viewport: group.viewport,
      sampleSize: group.diffPercentages.length,
      p95DiffPercentage,
    };

    if (group.pixelDiffs.length >= minSampleSize) {
      const p95PixelDiff = percentileNearestRank(group.pixelDiffs, percentile);
      if (p95PixelDiff !== undefined) {
        cap.p95PixelDiff = p95PixelDiff;
        cap.pixelSampleSize = group.pixelDiffs.length;
      }
    }

    caps[key] = cap;
  }

  return { percentile, minSampleSize, caps };
}

export async function listImages(dir: string): Promise<string[]> {
  if (!existsSync(dir)) return [];
  const files = await readdir(dir);
  return files.filter((f) => f.endsWith('.png'));
}

function normalizeImageMetadata(filename: string, value: unknown): ImageMetadata | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (typeof record.scenario !== 'string') return null;
  if (typeof record.browser !== 'string') return null;
  if (typeof record.viewport !== 'string') return null;

  const metadata: ImageMetadata = {
    filename,
    scenario: record.scenario,
    browser: record.browser,
    viewport: record.viewport,
  };

  if (typeof record.version === 'string' && record.version.length > 0) {
    metadata.version = record.version;
  }

  return metadata;
}

async function loadImageMetadataIndex(dir: string): Promise<Record<string, ImageMetadata> | null> {
  const metadataPath = getImageMetadataPath(dir);
  if (!existsSync(metadataPath)) return null;

  try {
    const content = await readFile(metadataPath, 'utf-8');
    const raw = JSON.parse(content) as unknown;
    const rawObject = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null;
    const schemaVersion =
      rawObject && typeof rawObject.schemaVersion === 'number' ? rawObject.schemaVersion : 0;

    if (schemaVersion > IMAGE_METADATA_SCHEMA_VERSION) {
      log.warn(`Unsupported image metadata schema version ${schemaVersion} in ${metadataPath}.`);
      return null;
    }

    const images = rawObject && 'images' in rawObject ? rawObject.images : raw;

    if (!images || typeof images !== 'object') return null;

    const index: Record<string, ImageMetadata> = {};
    for (const [filename, value] of Object.entries(images as Record<string, unknown>)) {
      const metadata = normalizeImageMetadata(filename, value);
      if (metadata) {
        index[filename] = metadata;
      }
    }
    return index;
  } catch (err) {
    log.warn(`Failed to load image metadata from ${metadataPath}:`, getErrorMessage(err));
    return null;
  }
}

export async function listImagesWithMetadata(dir: string): Promise<ImageMetadata[]> {
  const files = await listImages(dir);
  const metadataIndex = await loadImageMetadataIndex(dir);
  const updatedAtByFilename = new Map<string, string | undefined>();
  await Promise.all(
    files.map(async (filename) => {
      try {
        const s = await stat(join(dir, filename));
        updatedAtByFilename.set(filename, s.mtime.toISOString());
      } catch {
        updatedAtByFilename.set(filename, undefined);
      }
    })
  );

  return files.map((filename) => {
    const base = metadataIndex?.[filename] ?? parseImageFilename(filename);
    return { ...base, updatedAt: updatedAtByFilename.get(filename) };
  });
}

export interface ProjectImages {
  baselines: string[];
  tests: string[];
  diffs: string[];
  paths: { baselineDir: string; outputDir: string; diffDir: string };
  metadata: {
    baselines: ImageMetadata[];
    tests: ImageMetadata[];
    diffs: ImageMetadata[];
  };
  acceptances: Record<string, Acceptance>;
  flags: Record<string, ImageFlag>;
  autoThresholdCaps: AutoThresholdCaps;
}

export async function getProjectImages(
  projectPath: string,
  config?: PathConfig
): Promise<ProjectImages> {
  const { baselineDir, outputDir, diffDir } = getProjectDirs(projectPath, config);

  const [baselines, tests, diffs, acceptancesList, flagsList] = await Promise.all([
    listImages(baselineDir),
    listImages(outputDir),
    listImages(diffDir),
    loadAcceptances(projectPath),
    loadImageFlags(projectPath),
  ]);

  const [baselinesWithMeta, testsWithMeta, diffsWithMeta] = await Promise.all([
    listImagesWithMetadata(baselineDir),
    listImagesWithMetadata(outputDir),
    listImagesWithMetadata(diffDir),
  ]);

  return {
    baselines,
    tests,
    diffs,
    paths: { baselineDir, outputDir, diffDir },
    metadata: {
      baselines: baselinesWithMeta,
      tests: testsWithMeta,
      diffs: diffsWithMeta,
    },
    acceptances: acceptancesToMap(acceptancesList),
    flags: imageFlagsToMap(flagsList),
    autoThresholdCaps: computeAutoThresholdCaps(acceptancesList),
  };
}

export function getImageDirectory(
  projectPath: string,
  type: ImageType | string,
  config?: PathConfig
): string | null {
  switch (type) {
    case 'baseline':
      return getBaselineDir(projectPath, config);
    case 'test':
      return getOutputDir(projectPath, config);
    case 'diff':
      return getDiffDir(projectPath, config);
    default:
      return null;
  }
}

export async function approveImage(
  projectPath: string,
  filename: string,
  config?: PathConfig
): Promise<void> {
  const { testPath, baselinePath, diffPath, outputDir, baselineDir } = getProjectImagePaths(
    projectPath,
    filename,
    config
  );

  if (!existsSync(testPath)) {
    throw new Error('Test image not found');
  }

  // Copy test to baseline
  await copyFile(testPath, baselinePath);

  // Copy snapshot file if it exists alongside the test image
  const snapshotFilename = filename.replace(/\.png$/, '.snapshot.json');
  const testSnapshotPath = resolve(outputDir, snapshotFilename);
  const baselineSnapshotPath = resolve(baselineDir, snapshotFilename);
  if (existsSync(testSnapshotPath)) {
    await copyFile(testSnapshotPath, baselineSnapshotPath);
  }

  // Delete diff file so status updates from "failed" to "passed"
  if (existsSync(diffPath)) {
    await unlink(diffPath);
  }
}

export async function rejectImage(
  projectPath: string,
  filename: string,
  config?: PathConfig
): Promise<void> {
  const { testPath, diffPath } = getProjectImagePaths(projectPath, filename, config);

  if (existsSync(testPath)) await unlink(testPath);
  if (existsSync(diffPath)) await unlink(diffPath);
}

export interface BulkApproveFailure {
  filename: string;
  error: string;
}

export interface BulkApproveResult {
  approved: string[];
  failed: BulkApproveFailure[];
}

export async function bulkApproveImages(
  projectPath: string,
  filenames: string[],
  config?: PathConfig
): Promise<BulkApproveResult> {
  const approved: string[] = [];
  const failed: BulkApproveFailure[] = [];

  for (const filename of filenames) {
    try {
      await approveImage(projectPath, filename, config);
      approved.push(filename);
    } catch (err) {
      failed.push({
        filename,
        error: getErrorMessage(err, 'Unknown error'),
      });
    }
  }

  return { approved, failed };
}

export async function revertImage(
  projectPath: string,
  filename: string,
  config?: PathConfig
): Promise<void> {
  const baselineDir = getBaselineDir(projectPath, config);
  const baselinePath = resolve(baselineDir, filename);

  if (!existsSync(baselinePath)) {
    throw new Error('Baseline image not found');
  }

  await unlink(baselinePath);
}
