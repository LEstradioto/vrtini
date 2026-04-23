/**
 * Config loading from explicit project paths.
 *
 * Supports profiles: any file matching `vrtini*.config.json` is a profile.
 * Filename `vrtini.config.json` → default profile (name: "default").
 * Filename `vrtini.<name>.config.json` → named profile.
 *
 * Configs may declare `extends: "./base.json"` (string or array) to inherit
 * from another file. Extends is resolved relative to the file's directory,
 * merged deep (arrays replace), then stripped before schema validation.
 *
 * When a config omits `baselineDir`/`outputDir`, named profiles default to
 * `./.vrtini/<profile>/baselines` and `./.vrtini/<profile>/output` so
 * profiles don't clobber each other's artifacts.
 */
import { readFile, readdir } from 'fs/promises';
import { existsSync } from 'fs';
import { dirname, resolve, basename } from 'path';
import { ConfigSchema, type VRTConfig } from './config-schema.js';

export const CONFIG_FILENAMES = ['vrtini.config.json'];
const PROFILE_FILENAME_RE = /^vrtini(?:\.([A-Za-z0-9._-]+))?\.config\.json$/;
const DEFAULT_PROFILE = 'default';

export interface ProfileConfig {
  name: string;
  filename: string;
  path: string;
}

function formatZodErrors(errors: { path: (string | number)[]; message: string }[]): string {
  return errors.map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`).join('\n');
}

export function extractProfileName(filename: string): string | null {
  const match = basename(filename).match(PROFILE_FILENAME_RE);
  if (!match) return null;
  return match[1] ?? DEFAULT_PROFILE;
}

export function resolveConfigPath(projectPath: string, configFile?: string): string | null {
  if (configFile) {
    const absolutePath = resolve(projectPath, configFile);
    return existsSync(absolutePath) ? absolutePath : null;
  }

  for (const filename of CONFIG_FILENAMES) {
    const filepath = resolve(projectPath, filename);
    if (existsSync(filepath)) {
      return filepath;
    }
  }
  return null;
}

export async function listProfileConfigs(projectPath: string): Promise<ProfileConfig[]> {
  let entries: string[];
  try {
    entries = await readdir(projectPath);
  } catch {
    return [];
  }

  const profiles: ProfileConfig[] = [];
  for (const entry of entries) {
    const name = extractProfileName(entry);
    if (name === null) continue;
    profiles.push({ name, filename: entry, path: resolve(projectPath, entry) });
  }

  profiles.sort((a, b) => {
    if (a.name === DEFAULT_PROFILE) return -1;
    if (b.name === DEFAULT_PROFILE) return 1;
    return a.name.localeCompare(b.name);
  });

  return profiles;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function deepMergeConfigs(
  base: Record<string, unknown>,
  override: Record<string, unknown>
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    const current = result[key];
    if (isPlainObject(current) && isPlainObject(value)) {
      result[key] = deepMergeConfigs(current, value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

async function readJson(absolutePath: string): Promise<Record<string, unknown>> {
  if (!existsSync(absolutePath)) {
    throw new Error(`Config file not found: ${absolutePath}`);
  }
  const content = await readFile(absolutePath, 'utf-8');
  try {
    const parsed: unknown = JSON.parse(content);
    if (!isPlainObject(parsed)) {
      throw new Error(`Config file must contain a JSON object: ${absolutePath}`);
    }
    return parsed;
  } catch (err) {
    if (err instanceof SyntaxError) {
      throw new Error(`Invalid JSON in config file: ${absolutePath}`);
    }
    throw err;
  }
}

async function loadRawWithExtends(
  absolutePath: string,
  visited = new Set<string>()
): Promise<Record<string, unknown>> {
  if (visited.has(absolutePath)) {
    throw new Error(`Circular extends detected in config chain: ${absolutePath}`);
  }
  visited.add(absolutePath);

  const raw = await readJson(absolutePath);
  const extendsField = raw.extends;
  if (extendsField === undefined) return raw;

  const extendsList = Array.isArray(extendsField) ? extendsField : [extendsField];
  if (!extendsList.every((item): item is string => typeof item === 'string')) {
    throw new Error(
      `Invalid extends in ${absolutePath}: must be a string or array of strings (paths)`
    );
  }

  const baseDir = dirname(absolutePath);
  let merged: Record<string, unknown> = {};
  for (const relPath of extendsList) {
    const parentPath = resolve(baseDir, relPath);
    const parentRaw = await loadRawWithExtends(parentPath, new Set(visited));
    merged = deepMergeConfigs(merged, parentRaw);
  }

  const { extends: _drop, ...ownRaw } = raw;
  void _drop;
  return deepMergeConfigs(merged, ownRaw);
}

function applyProfileDefaults(
  raw: Record<string, unknown>,
  profileName: string | null
): Record<string, unknown> {
  if (!profileName || profileName === DEFAULT_PROFILE) return raw;

  const next: Record<string, unknown> = { ...raw };
  if (typeof next.baselineDir !== 'string') {
    next.baselineDir = `./.vrtini/${profileName}/baselines`;
  }
  if (typeof next.outputDir !== 'string') {
    next.outputDir = `./.vrtini/${profileName}/output`;
  }
  return next;
}

export async function loadConfigFromPath(absolutePath: string): Promise<VRTConfig> {
  const mergedRaw = await loadRawWithExtends(absolutePath);
  const profileName = extractProfileName(absolutePath);
  const withDefaults = applyProfileDefaults(mergedRaw, profileName);

  const result = ConfigSchema.safeParse(withDefaults);
  if (!result.success) {
    throw new Error(`Invalid config:\n${formatZodErrors(result.error.issues)}`);
  }

  return result.data;
}

export async function loadProjectConfig(
  projectPath: string,
  configFile?: string
): Promise<VRTConfig> {
  const configPath = resolveConfigPath(projectPath, configFile);

  if (!configPath) {
    const searched = configFile ?? CONFIG_FILENAMES.join(', ');
    throw new Error(`No config file found in ${projectPath}. Searched for: ${searched}`);
  }

  return loadConfigFromPath(configPath);
}
