import { resolve } from 'path';
import { resolveConfigPath, loadConfigFromPath, CONFIG_FILENAMES } from './config-manager.js';
import {
  ConfigSchema,
  type VRTConfig,
  type Viewport,
  type Scenario,
  type BrowserConfig,
} from './config-schema.js';

export { ConfigSchema };
export type { VRTConfig, Viewport, Scenario, BrowserConfig };

export async function loadConfig(configPath?: string): Promise<VRTConfig> {
  const cwd = process.cwd();
  const filepath = configPath ? resolve(cwd, configPath) : resolveConfigPath(cwd);

  if (!filepath) {
    throw new Error(
      `No config file found. Create vrtini.config.json or run \`vrtini init\`. Searched for: ${CONFIG_FILENAMES.join(', ')}`
    );
  }

  return loadConfigFromPath(filepath);
}
