import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { resolve, basename } from 'path';
import { ConfigSchema } from '../../../src/core/config.js';
import { listProfileConfigs, type ProfileConfig } from '../../../src/core/config-manager.js';
import { NotFoundError } from '../../../src/core/api-errors.js';
import { saveJsonFile } from '../../../src/core/json-file-store.js';

// ─── Server Info ─────────────────────────────────────────────────────────────

export interface ServerInfo {
  cwd: string;
  projectName: string;
  existingConfig: string | null;
  hasConfig: boolean;
}

const CONFIG_FILES = ['vrtini.config.json'];

export async function getServerInfo(): Promise<ServerInfo> {
  const cwd = process.cwd();
  const defaultMatch = CONFIG_FILES.find((f) => existsSync(resolve(cwd, f)));
  let existingConfig: string | null = defaultMatch ?? null;

  if (existingConfig === null) {
    const profiles = await listProfileConfigs(cwd);
    existingConfig = profiles[0]?.filename ?? null;
  }

  return {
    cwd,
    projectName: basename(cwd),
    existingConfig,
    hasConfig: existingConfig !== null,
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
    throw new NotFoundError(`Config file not found: ${configPath}`);
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
  await saveJsonFile(configPath, result.data);

  return { success: true, config: result.data };
}

export async function listProjectProfiles(projectPath: string): Promise<ProfileConfig[]> {
  return listProfileConfigs(projectPath);
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
