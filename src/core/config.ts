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

const CONFIG_FILE_LIST = CONFIG_FILENAMES.join(', ');

export async function findConfigFile(cwd: string = process.cwd()): Promise<string | null> {
  return resolveConfigPath(cwd);
}

export async function loadConfig(configPath?: string): Promise<VRTConfig> {
  const cwd = process.cwd();
  const filepath = configPath ? resolve(cwd, configPath) : resolveConfigPath(cwd);

  if (!filepath) {
    throw new Error(
      `No config file found. Create vrt.config.json or run \`vrt init\`. Searched for: ${CONFIG_FILE_LIST}`
    );
  }

  return loadConfigFromPath(filepath);
}

export function getDefaultConfig(): Partial<VRTConfig> {
  return {
    baselineDir: './.vrt/baselines',
    outputDir: './.vrt/output',
    browsers: ['chromium', 'webkit'],
    viewports: [
      { name: 'desktop', width: 1920, height: 1080 },
      { name: 'mobile', width: 375, height: 812 },
    ],
    threshold: 0.1,
    disableAnimations: true,
    diffColor: '#ff00ff',
    scenarios: [],
    ai: {
      enabled: false,
      provider: 'anthropic',
      manualOnly: false,
      analyzeThreshold: {
        maxPHashSimilarity: 0.95,
        maxSSIM: 0.98,
        minPixelDiff: 0.1,
      },
      autoApprove: {
        enabled: false,
        rules: [],
      },
      visionCompare: {
        enabled: true,
        chunks: 6,
        minImageHeight: 1800,
        maxVerticalAlignShift: 220,
        includeDiffImage: false,
      },
    },
    engines: {
      pixelmatch: { enabled: true, threshold: 0.1, antialiasing: true, alpha: 0.1 },
      odiff: { enabled: true, threshold: 0.1, antialiasing: true, failOnLayoutDiff: true },
      ssim: { enabled: true },
      phash: { enabled: true },
    },
    keepDiffOnMatch: false,
    autoThresholds: {
      enabled: false,
    },
    confidence: {
      passThreshold: 95,
      warnThreshold: 80,
    },
  };
}
