/**
 * Config loading from explicit project paths.
 */
import { readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { resolve } from 'path';
import { ConfigSchema, type VRTConfig } from './config-schema.js';

export const CONFIG_FILENAMES = ['vrt.config.json', '.vrtrc.json'];

function formatZodErrors(errors: { path: (string | number)[]; message: string }[]): string {
  return errors.map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`).join('\n');
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

export async function loadConfigFromPath(absolutePath: string): Promise<VRTConfig> {
  if (!existsSync(absolutePath)) {
    throw new Error(`Config file not found: ${absolutePath}`);
  }

  const content = await readFile(absolutePath, 'utf-8');

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error(`Invalid JSON in config file: ${absolutePath}`);
  }

  const result = ConfigSchema.safeParse(parsed);

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
