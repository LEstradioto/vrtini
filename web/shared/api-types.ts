/**
 * Client/server shared types.
 *
 * Most types are derived via `z.infer` from `api-schemas.ts` — that file is
 * the single source of truth so the client can't drift from what the server
 * actually validates. The hand-written pieces that remain are:
 *   - `formatBrowserLabel` (pure helper, no shape)
 *   - `VRTConfig` (client-side view of the full config; the authoritative
 *     zod schema lives in `src/core/config-schema.ts` and is richer than the
 *     loose client-side `VRTConfigSchema` here)
 *   - `BrowserConfig` alias
 */

import type { z } from 'zod';
import type {
  ImageMetadataSchema,
  AcceptanceMetricsSchema,
  AcceptanceSignalsSchema,
  AcceptanceSchema,
  ImageFlagSchema,
  AutoThresholdCapSchema,
  AutoThresholdCapsSchema,
  ChangeCategorySchema,
  SeveritySchema,
  RecommendationSchema,
  AIProviderNameSchema,
  AIAnalysisResultSchema,
  DomDiffSummarySchema,
  DomDiffFindingSchema,
  DomDiffStructuredSchema,
  EngineResultInfoSchema,
  CompareResultSchema,
  ImageResultSchema,
  ProjectTimingSchema,
  ProjectSchema,
  ConfigValidationIssueSchema,
  ConfigGetResponseSchema,
  ProfileConfigSchema,
  ProfileListResponseSchema,
  CrossReportSchema,
  CrossResultItemSchema,
  CrossResultsSchema,
  CrossResultsSummarySchema,
  CrossAcceptanceSchema,
  CrossFlagSchema,
  CrossCompareStartResponseSchema,
  CrossCompareStatusResponseSchema,
  AIProviderStatusSchema,
  AIProviderStatusResponseSchema,
  AIProviderValidationResponseSchema,
} from './api-schemas.js';

// Inferred record / response types -------------------------------------------

export type ImageMetadata = z.infer<typeof ImageMetadataSchema>;
export type AcceptanceMetrics = z.infer<typeof AcceptanceMetricsSchema>;
export type AcceptanceSignals = z.infer<typeof AcceptanceSignalsSchema>;
export type Acceptance = z.infer<typeof AcceptanceSchema>;
export type ImageFlag = z.infer<typeof ImageFlagSchema>;
export type AutoThresholdCap = z.infer<typeof AutoThresholdCapSchema>;
export type AutoThresholdCaps = z.infer<typeof AutoThresholdCapsSchema>;

export type ChangeCategory = z.infer<typeof ChangeCategorySchema>;
export type Severity = z.infer<typeof SeveritySchema>;
export type Recommendation = z.infer<typeof RecommendationSchema>;
export type AIProviderName = z.infer<typeof AIProviderNameSchema>;

export type AIAnalysisResult = z.infer<typeof AIAnalysisResultSchema>;
export type AIProviderStatus = z.infer<typeof AIProviderStatusSchema>;
export type AIProviderStatusResponse = z.infer<typeof AIProviderStatusResponseSchema>;
export type AIProviderValidationResponse = z.infer<typeof AIProviderValidationResponseSchema>;

export type DomDiffSummary = z.infer<typeof DomDiffSummarySchema>;
export type DomDiffFinding = z.infer<typeof DomDiffFindingSchema>;
export type DomDiffStructured = z.infer<typeof DomDiffStructuredSchema>;

export type EngineResultInfo = z.infer<typeof EngineResultInfoSchema>;
export type CompareResult = z.infer<typeof CompareResultSchema>;
export type ImageResult = z.infer<typeof ImageResultSchema>;

export type ProjectTiming = z.infer<typeof ProjectTimingSchema>;
export type Project = z.infer<typeof ProjectSchema>;

export type ConfigValidationIssue = z.infer<typeof ConfigValidationIssueSchema>;
export type ConfigGetResponse = z.infer<typeof ConfigGetResponseSchema>;
export type ProfileConfig = z.infer<typeof ProfileConfigSchema>;
export type ProfileListResponse = z.infer<typeof ProfileListResponseSchema>;

export type CrossReport = z.infer<typeof CrossReportSchema>;
export type CrossResultItem = z.infer<typeof CrossResultItemSchema>;
export type CrossResults = z.infer<typeof CrossResultsSchema>;
export type CrossResultsSummary = z.infer<typeof CrossResultsSummarySchema>;
export type CrossAcceptance = z.infer<typeof CrossAcceptanceSchema>;
export type CrossFlag = z.infer<typeof CrossFlagSchema>;
export type CrossCompareStartResponse = z.infer<typeof CrossCompareStartResponseSchema>;
export type CrossCompareStatusResponse = z.infer<typeof CrossCompareStatusResponseSchema>;

// Helpers --------------------------------------------------------------------

export function formatBrowserLabel(browser: string, version?: string): string {
  return `${browser.charAt(0).toUpperCase() + browser.slice(1)} ${version ? 'v' + version : '(latest)'}`;
}

// Config shapes --------------------------------------------------------------
// The authoritative zod schema is in `src/core/config-schema.ts`. The client
// can't import it directly (server-only path). These interfaces mirror the
// subset the client needs to edit in the Config UI; drift is possible but
// the server validates every inbound config via the real schema.

export interface ScenarioOptions {
  waitFor?: 'load' | 'networkidle' | 'domcontentloaded';
  waitForSelector?: string;
  waitForTimeout?: number;
  beforeScreenshot?: string;
  postInteractionWait?: number;
  selector?: string;
  fullPage?: boolean;
  hideSelectors?: string[];
  removeSelectors?: string[];
  blockUrls?: string[];
  diffThreshold?: {
    maxDiffPercentage?: number;
    maxDiffPixels?: number;
  };
}

export interface Scenario extends ScenarioOptions {
  name: string;
  url: string;
}

export type BrowserConfig =
  | 'chromium'
  | 'webkit'
  | { name: 'chromium' | 'webkit'; version?: string };

export interface VRTConfig {
  baselineDir: string;
  outputDir: string;
  browsers: BrowserConfig[];
  viewports: { name: string; width: number; height: number }[];
  threshold: number;
  quickMode?: boolean;
  diffThreshold?: {
    maxDiffPercentage?: number;
    maxDiffPixels?: number;
  };
  autoThresholds?: {
    enabled: boolean;
    percentile?: number;
    minSampleSize?: number;
  };
  disableAnimations: boolean;
  diffColor: string;
  concurrency?: number;
  confidence?: {
    passThreshold?: number;
    warnThreshold?: number;
  };
  scenarioDefaults?: ScenarioOptions;
  scenarios: Scenario[];
  engines?: {
    pixelmatch?: {
      enabled?: boolean;
      threshold?: number;
      antialiasing?: boolean;
      alpha?: number;
    };
    odiff?: {
      enabled?: boolean;
      threshold?: number;
      antialiasing?: boolean;
      failOnLayoutDiff?: boolean;
      outputDiffMask?: boolean;
    };
    ssim?: {
      enabled?: boolean;
      threshold?: number;
      antialiasing?: boolean;
    };
    phash?: {
      enabled?: boolean;
      threshold?: number;
      antialiasing?: boolean;
    };
  };
  crossCompare?: {
    pairs?: string[];
    normalization?: 'pad' | 'resize' | 'crop';
    mismatch?: 'strict' | 'ignore';
    verticalAlign?: {
      enabled?: boolean;
      maxShift?: number;
      minConfidence?: number;
    };
  };
  ai?: {
    enabled: boolean;
    provider: AIProviderName;
    apiKey?: string;
    authToken?: string;
    model?: string;
    baseUrl?: string;
    manualOnly?: boolean;
    analyzeThreshold: {
      maxPHashSimilarity: number;
      maxSSIM: number;
      minPixelDiff: number;
    };
    autoApprove: {
      enabled: boolean;
      rules: unknown[];
    };
    visionCompare?: {
      enabled?: boolean;
      chunks?: number;
      minImageHeight?: number;
      maxVerticalAlignShift?: number;
      includeDiffImage?: boolean;
    };
  };
  domSnapshot?: {
    enabled?: boolean;
    maxElements?: number;
  };
  report?: {
    embedImages?: boolean;
  };
  keepDiffOnMatch?: boolean;
}
