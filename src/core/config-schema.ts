import { z } from 'zod';

const ViewportSchema = z.object({
  name: z.string(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});

// Browser config: simple string or object with version
const BrowserConfigSchema = z.union([
  z.enum(['chromium', 'webkit']),
  z.object({
    name: z.enum(['chromium', 'webkit']),
    version: z.string().optional(),
  }),
]);

const ScenarioOptionsSchema = z.object({
  waitFor: z.enum(['load', 'networkidle', 'domcontentloaded']).optional(),
  waitForSelector: z.string().optional(),
  waitForTimeout: z.number().int().nonnegative().optional(),
  beforeScreenshot: z.string().optional(),
  postInteractionWait: z.number().int().nonnegative().optional(),
  selector: z.string().optional(),
  fullPage: z.boolean().optional(),
  // Element visibility controls (like BackstopJS)
  hideSelectors: z.array(z.string()).optional(), // visibility: hidden
  removeSelectors: z.array(z.string()).optional(), // display: none
  // Network blocking (substring match)
  blockUrls: z.array(z.string()).optional(),
  diffThreshold: z
    .object({
      maxDiffPercentage: z.number().min(0).max(100).optional(),
      maxDiffPixels: z.number().min(0).optional(),
    })
    .optional(),
});

const ScenarioSchema = ScenarioOptionsSchema.extend({
  name: z.string(),
  url: z.string().url(),
});

const AutoApproveRuleSchema = z.object({
  condition: z.object({
    categories: z
      .array(z.enum(['cosmetic', 'noise', 'content_change', 'layout_shift', 'regression']))
      .optional(),
    maxSeverity: z.enum(['info', 'warning', 'critical']).optional(),
    minConfidence: z.number().min(0).max(1).optional(),
    maxPixelDiff: z.number().min(0).optional(),
    minSSIM: z.number().min(0).max(1).optional(),
    minPHash: z.number().min(0).max(1).optional(),
    maxDomTextChanges: z.number().int().min(0).optional(),
  }),
  action: z.enum(['approve', 'flag', 'reject']),
});

const EngineConfigSchema = z.object({
  enabled: z.boolean().default(true),
  threshold: z.number().min(0).max(1).optional(),
  antialiasing: z.boolean().optional(),
});

const EnginesConfigSchema = z
  .object({
    pixelmatch: EngineConfigSchema.extend({
      alpha: z.number().min(0).max(1).optional(),
    }).default({ enabled: true }),
    odiff: EngineConfigSchema.extend({
      failOnLayoutDiff: z.boolean().optional(),
      outputDiffMask: z.boolean().optional(),
    }).default({ enabled: true }),
    ssim: EngineConfigSchema.default({ enabled: true }),
    phash: EngineConfigSchema.default({ enabled: true }),
  })
  .default({});

const CrossCompareSchema = z
  .object({
    pairs: z.array(z.string()).optional(),
    normalization: z.enum(['pad', 'resize', 'crop']).default('pad'),
    mismatch: z.enum(['strict', 'ignore']).default('strict'),
  })
  .default({});

const DiffThresholdSchema = z
  .object({
    maxDiffPercentage: z.number().min(0).max(100).optional(),
    maxDiffPixels: z.number().min(0).optional(),
  })
  .optional();

const ConfidenceThresholdsSchema = z
  .object({
    passThreshold: z.number().min(0).max(100).default(95),
    warnThreshold: z.number().min(0).max(100).default(80),
  })
  .default({});

const AutoThresholdsSchema = z.object({
  enabled: z.boolean().default(false),
  percentile: z.number().min(0).max(1).optional(),
  minSampleSize: z.number().int().min(1).optional(),
});

const DomSnapshotSchema = z
  .object({
    enabled: z.boolean().default(false),
    maxElements: z.number().int().min(100).max(10000).default(2000),
  })
  .default({});

const AIAnalysisSchema = z.object({
  enabled: z.boolean().default(false),
  provider: z.enum(['anthropic', 'openai', 'openrouter', 'google']).default('anthropic'),
  apiKey: z.string().optional(),
  authToken: z.string().optional(),
  model: z.string().optional(),
  baseUrl: z.string().url().optional(),
  manualOnly: z.boolean().default(false),
  // Only analyze diffs that exceed these thresholds (to save API costs)
  analyzeThreshold: z
    .object({
      maxPHashSimilarity: z.number().min(0).max(1).default(0.95), // Only analyze if pHash < this
      maxSSIM: z.number().min(0).max(1).default(0.98), // Only analyze if SSIM < this
      minPixelDiff: z.number().min(0).default(0.1), // Only analyze if diff > this %
    })
    .default({}),
  // Auto-approval rules
  autoApprove: z
    .object({
      enabled: z.boolean().default(false),
      rules: z.array(AutoApproveRuleSchema).default([]),
    })
    .default({}),
  // Vision compare tuning for long pages (baseline/test chunking + vertical alignment)
  visionCompare: z
    .object({
      enabled: z.boolean().default(true),
      chunks: z.number().int().min(1).max(12).default(6),
      minImageHeight: z.number().int().min(400).max(12000).default(1800),
      maxVerticalAlignShift: z.number().int().min(0).max(2000).default(220),
      includeDiffImage: z.boolean().default(false),
    })
    .default({}),
});

export const ConfigSchema = z.object({
  baselineDir: z.string().default('./.vrt/baselines'),
  outputDir: z.string().default('./.vrt/output'),
  browsers: z.array(BrowserConfigSchema).default(['chromium']),
  viewports: z.array(ViewportSchema).default([{ name: 'desktop', width: 1920, height: 1080 }]),
  threshold: z.number().min(0).max(1).default(0.1),
  diffThreshold: DiffThresholdSchema,
  disableAnimations: z.boolean().default(true),
  diffColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .default('#ff00ff'),
  // Parallel concurrency for screenshot batching and comparisons (default: 5)
  concurrency: z.number().int().min(1).max(20).default(5),
  // Quick mode: fast comparison using only pixelmatch (skips SSIM, pHash, odiff)
  // ~5x faster but less detailed analysis
  quickMode: z.boolean().default(false),
  // Default options applied to all scenarios
  scenarioDefaults: ScenarioOptionsSchema.optional(),
  scenarios: z.array(ScenarioSchema).min(1),
  // AI analysis settings
  ai: AIAnalysisSchema.optional(),
  // Comparison engines (ignored if quickMode is true)
  engines: EnginesConfigSchema.optional(),
  // Cross-compare normalization options
  crossCompare: CrossCompareSchema.optional(),
  // Auto-thresholds derived from approvals
  autoThresholds: AutoThresholdsSchema.optional(),
  // Confidence thresholds
  confidence: ConfidenceThresholdsSchema.optional(),
  // DOM snapshot capture (opt-in)
  domSnapshot: DomSnapshotSchema.optional(),
  // Report options
  report: z
    .object({
      // Embed images as base64 in report HTML (large reports can exceed string limits)
      embedImages: z.boolean().optional(),
    })
    .optional(),
  // Keep diff images even when screenshots match
  keepDiffOnMatch: z.boolean().default(false),
});

export type VRTConfig = z.infer<typeof ConfigSchema>;
export type Viewport = z.infer<typeof ViewportSchema>;
export type Scenario = z.infer<typeof ScenarioSchema>;
export type BrowserConfig = z.infer<typeof BrowserConfigSchema>;
