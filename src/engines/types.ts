export type EngineName = 'pixelmatch' | 'odiff' | 'ssim' | 'phash';

export interface EngineResult {
  engine: EngineName;
  diffPixels?: number;
  diffPercent: number;
  similarity: number; // 0-1, where 1 = identical
  diffImagePath?: string;
  error?: string;
}

export interface EngineConfig {
  enabled: boolean;
  threshold?: number;
  antialiasing?: boolean;
}

export interface PixelmatchConfig extends EngineConfig {
  alpha?: number;
}

export interface OdiffConfig extends EngineConfig {
  failOnLayoutDiff?: boolean;
  outputDiffMask?: boolean;
}

export interface EnginesConfig {
  pixelmatch: PixelmatchConfig;
  odiff: OdiffConfig;
  ssim: EngineConfig;
  phash: EngineConfig;
}

export const DEFAULT_ENGINES_CONFIG: EnginesConfig = {
  pixelmatch: { enabled: true, threshold: 0.1, antialiasing: true, alpha: 0.1 },
  odiff: {
    enabled: true, // Enabled by default for better antialiasing detection
    threshold: 0.1,
    antialiasing: true,
    failOnLayoutDiff: true,
    outputDiffMask: false,
  },
  ssim: { enabled: true },
  phash: { enabled: true },
};
