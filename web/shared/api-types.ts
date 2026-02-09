export interface ImageMetadata {
  filename: string;
  scenario: string;
  browser: string;
  version?: string;
  viewport: string;
  /** Screenshot file mtime (ISO). Useful to spot stale baselines/tests. */
  updatedAt?: string;
}

export function formatBrowserLabel(browser: string, version?: string): string {
  return `${browser.charAt(0).toUpperCase() + browser.slice(1)} ${version ? 'v' + version : '(latest)'}`;
}

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

export type ChangeCategory =
  | 'regression'
  | 'cosmetic'
  | 'content_change'
  | 'layout_shift'
  | 'noise';
export type Severity = 'critical' | 'warning' | 'info';
export type Recommendation = 'approve' | 'review' | 'reject';

export interface AIAnalysisResult {
  category: ChangeCategory;
  severity: Severity;
  confidence: number;
  summary: string;
  details: string[];
  recommendation: Recommendation;
  reasoning: string;
  provider: string;
  model: string;
  tokensUsed?: number;
}

export interface DomDiffSummary {
  findingCount: number;
  similarity: number;
  topFindings: { type: string; severity: string; description: string }[];
  summary: Record<string, number>;
}

export interface CompareResult {
  diffUrl: string;
  diffFilename: string;
  pixelDiff: number;
  diffPercentage: number;
  ssimScore?: number;
  phash?: {
    similarity: number;
    baselineHash: string;
    testHash: string;
  };
  domDiff?: DomDiffSummary;
}

export interface ImageResult {
  status: 'passed' | 'failed' | 'new';
  confidence?: { score: number; pass: boolean; verdict: 'pass' | 'warn' | 'fail' };
  metrics?: { pixelDiff: number; diffPercentage: number; ssimScore?: number };
}

export interface ProjectTiming {
  screenshotDuration?: number; // ms
  compareDuration?: number; // ms
  totalDuration?: number; // ms
}

export interface Project {
  id: string;
  name: string;
  path: string;
  configFile: string;
  createdAt: string;
  lastRun?: string;
  lastStatus?: 'passed' | 'failed' | 'new';
  lastTiming?: ProjectTiming;
}

export interface CrossReport {
  key: string;
  title: string;
  reportPath: string;
  url: string;
}

export interface CrossResultItem {
  itemKey?: string;
  name: string;
  scenario: string;
  viewport: string;
  baseline: string;
  test: string;
  diff?: string;
  /** mtime (ISO) of the underlying baseline screenshot file, if available */
  baselineUpdatedAt?: string;
  /** mtime (ISO) of the underlying test screenshot file, if available */
  testUpdatedAt?: string;
  /** mtime (ISO) of the generated diff image file, if available */
  diffUpdatedAt?: string;
  match: boolean;
  reason: 'match' | 'diff' | 'no-baseline' | 'no-test' | 'error';
  diffPercentage: number;
  pixelDiff: number;
  ssimScore?: number;
  phash?: {
    similarity: number;
    baselineHash: string;
    testHash: string;
  };
  error?: string;
  accepted?: boolean;
  acceptedAt?: string;
}

export interface CrossResults {
  key: string;
  title: string;
  generatedAt: string;
  baselineLabel: string;
  testLabel: string;
  items: CrossResultItem[];
}

export interface CrossResultsSummary {
  key: string;
  title: string;
  generatedAt: string;
  baselineLabel: string;
  testLabel: string;
  itemCount: number;
  approvedCount: number;
  smartPassCount: number;
  matchCount: number;
  diffCount: number;
  issueCount: number;
}

export interface CrossAcceptance {
  itemKey: string;
  acceptedAt: string;
  reason?: string;
}

// Scenario options (used in scenarios and scenarioDefaults)
export interface ScenarioOptions {
  waitFor?: 'load' | 'networkidle' | 'domcontentloaded';
  waitForSelector?: string;
  waitForTimeout?: number;
  beforeScreenshot?: string;
  postInteractionWait?: number;
  selector?: string;
  fullPage?: boolean;
  hideSelectors?: string[]; // visibility: hidden
  removeSelectors?: string[]; // display: none
  blockUrls?: string[]; // substring match
  diffThreshold?: {
    maxDiffPercentage?: number;
    maxDiffPixels?: number;
  };
}

export interface Scenario extends ScenarioOptions {
  name: string;
  url: string;
}

// Browser config: simple string or object with version
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
  concurrency?: number; // Parallel page concurrency (1-20, default: 5)
  scenarioDefaults?: ScenarioOptions; // Default options for all scenarios
  scenarios: Scenario[];
  crossCompare?: {
    normalization?: 'pad' | 'resize' | 'crop';
    mismatch?: 'strict' | 'ignore';
  };
  ai?: {
    enabled: boolean;
    provider: 'anthropic' | 'openai';
    apiKey?: string;
    model?: string;
    analyzeThreshold: {
      maxPHashSimilarity: number;
      maxSSIM: number;
      minPixelDiff: number;
    };
    autoApprove: {
      enabled: boolean;
      rules: unknown[];
    };
  };
  domSnapshot?: {
    enabled: boolean;
    maxElements: number;
  };
}
