import { z } from 'zod';

// --- Base type schemas (mirrors api-types.ts interfaces) ---

export const ImageMetadataSchema = z.object({
  filename: z.string(),
  scenario: z.string(),
  browser: z.string(),
  version: z.string().optional(),
  viewport: z.string(),
  updatedAt: z.string().optional(),
});

export const AcceptanceMetricsSchema = z.object({
  diffPercentage: z.number(),
  pixelDiff: z.number().optional(),
  ssimScore: z.number().optional(),
  phash: z.number().optional(),
});

export const AcceptanceSignalsSchema = z.object({
  scenario: z.string().optional(),
  viewport: z.string().optional(),
  viewportWidth: z.number().optional(),
  viewportHeight: z.number().optional(),
  browserPair: z
    .object({
      baseline: z
        .object({ name: z.string().optional(), version: z.string().optional() })
        .optional(),
      test: z.object({ name: z.string().optional(), version: z.string().optional() }).optional(),
    })
    .optional(),
});

export const AcceptanceSchema = z.object({
  filename: z.string(),
  acceptedAt: z.string(),
  reason: z.string().optional(),
  comparedAgainst: z.object({
    filename: z.string(),
    type: z.enum(['baseline', 'test']),
  }),
  metrics: AcceptanceMetricsSchema,
  signals: AcceptanceSignalsSchema.optional(),
});

export const ImageFlagSchema = z.object({
  filename: z.string(),
  flaggedAt: z.string(),
  reason: z.string().optional(),
});

export const AutoThresholdCapSchema = z.object({
  scenario: z.string(),
  viewport: z.string(),
  sampleSize: z.number(),
  p95DiffPercentage: z.number(),
  p95PixelDiff: z.number().optional(),
  pixelSampleSize: z.number().optional(),
});

export const AutoThresholdCapsSchema = z.object({
  percentile: z.number(),
  minSampleSize: z.number(),
  caps: z.record(z.string(), AutoThresholdCapSchema),
});

const ChangeCategorySchema = z.enum([
  'regression',
  'cosmetic',
  'content_change',
  'layout_shift',
  'noise',
]);

const SeveritySchema = z.enum(['critical', 'warning', 'info']);
const RecommendationSchema = z.enum(['approve', 'review', 'reject']);
const AIProviderNameSchema = z.enum(['anthropic', 'openai', 'openrouter', 'google']);

export const AIAnalysisResultSchema = z.object({
  category: ChangeCategorySchema,
  severity: SeveritySchema,
  confidence: z.number(),
  summary: z.string(),
  details: z.array(z.string()),
  recommendation: RecommendationSchema,
  reasoning: z.string(),
  provider: z.string(),
  model: z.string(),
  tokensUsed: z.number().optional(),
});

export const DomDiffSummarySchema = z.object({
  findingCount: z.number(),
  similarity: z.number(),
  topFindings: z.array(
    z.object({
      type: z.string(),
      severity: z.string(),
      description: z.string(),
    })
  ),
  summary: z.record(z.string(), z.number()),
});

export const CompareResultSchema = z.object({
  diffUrl: z.string(),
  diffFilename: z.string(),
  pixelDiff: z.number(),
  diffPercentage: z.number(),
  ssimScore: z.number().optional(),
  phash: z
    .object({
      similarity: z.number(),
      baselineHash: z.string(),
      testHash: z.string(),
    })
    .optional(),
  domDiff: DomDiffSummarySchema.optional(),
});

export const DomDiffFindingSchema = z.object({
  type: z.string(),
  path: z.string(),
  tag: z.string(),
  severity: z.enum(['critical', 'warning', 'info']),
  description: z.string(),
  detail: z.record(z.string(), z.unknown()).optional(),
});

export const DomDiffStructuredSchema = z.object({
  findings: z.array(DomDiffFindingSchema),
  summary: z.record(z.string(), z.number()),
  similarity: z.number(),
});

export const ImageResultSchema = z.object({
  status: z.enum(['passed', 'failed', 'new']),
  confidence: z
    .object({
      score: z.number(),
      pass: z.boolean(),
      verdict: z.enum(['pass', 'warn', 'fail']),
    })
    .optional(),
  metrics: z
    .object({
      pixelDiff: z.number(),
      diffPercentage: z.number(),
      ssimScore: z.number().optional(),
    })
    .optional(),
});

export const ProjectTimingSchema = z.object({
  screenshotDuration: z.number().optional(),
  compareDuration: z.number().optional(),
  totalDuration: z.number().optional(),
});

export const ProjectSchema = z.object({
  id: z.string(),
  name: z.string(),
  path: z.string(),
  configFile: z.string(),
  createdAt: z.string(),
  lastRun: z.string().optional(),
  lastStatus: z.enum(['passed', 'failed', 'new']).optional(),
  lastTiming: ProjectTimingSchema.optional(),
});

export const CrossReportSchema = z.object({
  key: z.string(),
  title: z.string(),
  reportPath: z.string(),
  url: z.string(),
});

export const CrossResultItemSchema = z.object({
  itemKey: z.string().optional(),
  name: z.string(),
  scenario: z.string(),
  viewport: z.string(),
  baseline: z.string(),
  test: z.string(),
  diff: z.string().optional(),
  baselineUpdatedAt: z.string().optional(),
  testUpdatedAt: z.string().optional(),
  diffUpdatedAt: z.string().optional(),
  match: z.boolean(),
  reason: z.enum(['match', 'diff', 'no-baseline', 'no-test', 'error']),
  diffPercentage: z.number(),
  pixelDiff: z.number(),
  ssimScore: z.number().optional(),
  phash: z
    .object({
      similarity: z.number(),
      baselineHash: z.string(),
      testHash: z.string(),
    })
    .optional(),
  domDiff: DomDiffStructuredSchema.optional(),
  error: z.string().optional(),
  accepted: z.boolean().optional(),
  acceptedAt: z.string().optional(),
  flagged: z.boolean().optional(),
  flaggedAt: z.string().optional(),
  aiAnalysis: AIAnalysisResultSchema.optional(),
  outdated: z.boolean().optional(),
});

export const CrossResultsSchema = z.object({
  key: z.string(),
  title: z.string(),
  generatedAt: z.string(),
  baselineLabel: z.string(),
  testLabel: z.string(),
  items: z.array(CrossResultItemSchema),
});

export const CrossResultsSummarySchema = z.object({
  key: z.string(),
  title: z.string(),
  generatedAt: z.string(),
  baselineLabel: z.string(),
  testLabel: z.string(),
  itemCount: z.number(),
  approvedCount: z.number(),
  smartPassCount: z.number(),
  matchCount: z.number(),
  diffCount: z.number(),
  issueCount: z.number(),
  flaggedCount: z.number(),
  outdatedCount: z.number().optional(),
});

export const CrossAcceptanceSchema = z.object({
  itemKey: z.string(),
  acceptedAt: z.string(),
  reason: z.string().optional(),
});

export const CrossFlagSchema = z.object({
  itemKey: z.string(),
  flaggedAt: z.string(),
  reason: z.string().optional(),
});

// BrowserConfig matches api-types.ts
const BrowserConfigSchema = z.union([
  z.literal('chromium'),
  z.literal('webkit'),
  z.object({
    name: z.enum(['chromium', 'webkit']),
    version: z.string().optional(),
  }),
]);

// Simplified VRTConfig schema for API response validation (not config file parsing)
export const VRTConfigSchema = z
  .object({
    baselineDir: z.string(),
    outputDir: z.string(),
    browsers: z.array(BrowserConfigSchema),
    viewports: z.array(z.object({ name: z.string(), width: z.number(), height: z.number() })),
    threshold: z.number(),
    quickMode: z.boolean().optional(),
    diffThreshold: z
      .object({
        maxDiffPercentage: z.number().optional(),
        maxDiffPixels: z.number().optional(),
      })
      .optional(),
    autoThresholds: z
      .object({
        enabled: z.boolean(),
        percentile: z.number().optional(),
        minSampleSize: z.number().optional(),
      })
      .optional(),
    disableAnimations: z.boolean(),
    diffColor: z.string(),
    concurrency: z.number().optional(),
    confidence: z
      .object({
        passThreshold: z.number().optional(),
        warnThreshold: z.number().optional(),
      })
      .optional(),
    scenarioDefaults: z.record(z.unknown()).optional(),
    scenarios: z.array(
      z
        .object({
          name: z.string(),
          url: z.string(),
        })
        .passthrough()
    ),
    crossCompare: z
      .object({
        pairs: z.array(z.string()).optional(),
        normalization: z.enum(['pad', 'resize', 'crop']).optional(),
        mismatch: z.enum(['strict', 'ignore']).optional(),
      })
      .optional(),
    engines: z
      .object({
        pixelmatch: z
          .object({
            enabled: z.boolean().optional(),
            threshold: z.number().optional(),
            antialiasing: z.boolean().optional(),
            alpha: z.number().optional(),
          })
          .optional(),
        odiff: z
          .object({
            enabled: z.boolean().optional(),
            threshold: z.number().optional(),
            antialiasing: z.boolean().optional(),
            failOnLayoutDiff: z.boolean().optional(),
            outputDiffMask: z.boolean().optional(),
          })
          .optional(),
        ssim: z
          .object({
            enabled: z.boolean().optional(),
            threshold: z.number().optional(),
            antialiasing: z.boolean().optional(),
          })
          .optional(),
        phash: z
          .object({
            enabled: z.boolean().optional(),
            threshold: z.number().optional(),
            antialiasing: z.boolean().optional(),
          })
          .optional(),
      })
      .optional(),
    domSnapshot: z
      .object({
        enabled: z.boolean().optional(),
        maxElements: z.number().optional(),
      })
      .optional(),
    report: z
      .object({
        embedImages: z.boolean().optional(),
      })
      .optional(),
    keepDiffOnMatch: z.boolean().optional(),
    ai: z
      .object({
        enabled: z.boolean(),
        provider: AIProviderNameSchema,
        apiKey: z.string().optional(),
        authToken: z.string().optional(),
        model: z.string().optional(),
        baseUrl: z.string().optional(),
        manualOnly: z.boolean().optional(),
        analyzeThreshold: z.object({
          maxPHashSimilarity: z.number(),
          maxSSIM: z.number(),
          minPixelDiff: z.number(),
        }),
        autoApprove: z.object({
          enabled: z.boolean(),
          rules: z.array(z.unknown()),
        }),
      })
      .optional(),
  })
  .passthrough();

// --- API response schemas ---

export const InfoResponseSchema = z.object({
  cwd: z.string(),
  projectName: z.string(),
  existingConfig: z.string().nullable(),
  hasConfig: z.boolean(),
});

export const ProjectListResponseSchema = z.object({ projects: z.array(ProjectSchema) });
export const ProjectResponseSchema = z.object({ project: ProjectSchema });
export const SuccessResponseSchema = z.object({ success: z.boolean() });

export const ConfigGetResponseSchema = z.object({
  config: z.unknown().nullable(),
  raw: z.unknown(),
  valid: z.boolean(),
  errors: z.array(z.object({ path: z.string(), message: z.string() })).nullable(),
});

export const ConfigSaveResponseSchema = z.object({
  success: z.boolean(),
  config: VRTConfigSchema,
});

export const SchemaResponseSchema = z.object({
  browsers: z.array(z.string()),
  waitForOptions: z.array(z.string()),
  aiProviders: z.array(z.string()),
  severityLevels: z.array(z.string()),
  changeCategories: z.array(z.string()),
  ruleActions: z.array(z.string()),
});

export const ImagesListResponseSchema = z.object({
  baselines: z.array(z.string()),
  tests: z.array(z.string()),
  diffs: z.array(z.string()),
  paths: z.object({
    baselineDir: z.string(),
    outputDir: z.string(),
    diffDir: z.string(),
  }),
  metadata: z.object({
    baselines: z.array(ImageMetadataSchema),
    tests: z.array(ImageMetadataSchema),
    diffs: z.array(ImageMetadataSchema),
  }),
  acceptances: z.record(z.string(), AcceptanceSchema),
  flags: z.record(z.string(), ImageFlagSchema),
  autoThresholdCaps: AutoThresholdCapsSchema,
});

export const ApproveResponseSchema = z.object({
  success: z.boolean(),
  approved: z.string(),
});

export const RejectResponseSchema = z.object({
  success: z.boolean(),
  rejected: z.string(),
});

export const BulkApproveResponseSchema = z.object({
  success: z.boolean(),
  approved: z.array(z.string()),
  failed: z.array(z.object({ filename: z.string(), error: z.string() })),
});

export const RevertResponseSchema = z.object({
  success: z.boolean(),
  reverted: z.string(),
});

export const ImageResultsResponseSchema = z.object({
  results: z.record(z.string(), ImageResultSchema),
});

export const CrossCompareRunResponseSchema = z.object({
  reports: z.array(CrossReportSchema),
});

export const CrossCompareStartResponseSchema = z.object({
  jobId: z.string(),
  status: z.literal('running'),
  phase: z.enum(['preparing', 'running', 'done']),
  progress: z.number(),
  total: z.number(),
  pairIndex: z.number(),
  pairTotal: z.number(),
  currentPairKey: z.string().optional(),
  currentPairTitle: z.string().optional(),
  startedAt: z.string(),
});

export const CrossCompareStatusResponseSchema = z.object({
  id: z.string(),
  status: z.enum(['running', 'completed', 'failed']),
  phase: z.enum(['preparing', 'running', 'done']),
  progress: z.number(),
  total: z.number(),
  pairIndex: z.number(),
  pairTotal: z.number(),
  currentPairKey: z.string().optional(),
  currentPairTitle: z.string().optional(),
  reports: z.array(CrossReportSchema),
  error: z.string().optional(),
  startedAt: z.string(),
  completedAt: z.string().optional(),
});

export const CrossResultsResponseSchema = z.object({
  results: CrossResultsSchema,
});

export const CrossResultsListResponseSchema = z.object({
  results: z.array(CrossResultsSummarySchema),
});

export const CrossDeleteResponseSchema = z.object({
  success: z.boolean(),
  deleted: z.array(z.string()),
  missing: z.array(z.string()),
});

export const CrossAcceptResponseSchema = z.object({
  success: z.boolean(),
  acceptance: CrossAcceptanceSchema,
});

export const ImageFlagResponseSchema = z.object({
  success: z.boolean(),
  flag: ImageFlagSchema,
});

export const CrossFlagResponseSchema = z.object({
  success: z.boolean(),
  flag: CrossFlagSchema,
});

export const AcceptanceListResponseSchema = z.object({
  acceptances: z.array(AcceptanceSchema),
  acceptanceMap: z.record(z.string(), AcceptanceSchema),
});

export const AcceptanceCreateResponseSchema = z.object({
  success: z.boolean(),
  acceptance: AcceptanceSchema,
});

export const RevokeResponseSchema = z.object({
  success: z.boolean(),
  revoked: z.string(),
});

export const AnalyzeResponseSchema = z.object({
  results: z.array(
    z.object({
      filename: z.string(),
      analysis: AIAnalysisResultSchema.optional(),
      error: z.string().optional(),
    })
  ),
});

export const AIProviderStatusSchema = z.object({
  provider: AIProviderNameSchema,
  configured: z.boolean(),
  active: z.boolean(),
  source: z.enum(['config', 'env', 'config+env', 'none']),
  detail: z.string(),
});

export const AIProviderStatusResponseSchema = z.object({
  activeProvider: AIProviderNameSchema.nullable(),
  providers: z.array(AIProviderStatusSchema),
});

export const AIProviderValidationResponseSchema = z.object({
  provider: AIProviderNameSchema,
  valid: z.boolean(),
  source: z.enum(['input', 'env', 'none']),
  message: z.string(),
});

export const TestRunResponseSchema = z.object({
  jobId: z.string(),
  status: z.string(),
  total: z.number(),
});

export const TestStatusResponseSchema = z.object({
  id: z.string(),
  status: z.enum(['running', 'completed', 'failed', 'aborted']),
  progress: z.number(),
  total: z.number(),
  phase: z.enum(['capturing', 'comparing', 'done']),
  results: z.array(z.unknown()),
  error: z.string().optional(),
  timing: ProjectTimingSchema.optional(),
});

export const TestAbortResponseSchema = z.object({
  status: z.literal('aborted'),
  progress: z.number(),
  total: z.number(),
  results: z.array(z.unknown()),
});

export const TestRerunResponseSchema = z.object({
  jobId: z.string(),
  status: z.string(),
  total: z.number(),
  failed: z.array(z.string()).optional(),
});
