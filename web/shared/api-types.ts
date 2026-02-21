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

export interface ImageFlag {
  filename: string;
  flaggedAt: string;
  reason?: string;
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
export type AIProviderName = 'anthropic' | 'openai' | 'openrouter' | 'google';

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

export interface AIProviderStatus {
  provider: AIProviderName;
  configured: boolean;
  active: boolean;
  source: 'config' | 'env' | 'config+env' | 'none';
  detail: string;
}

export interface AIProviderStatusResponse {
  activeProvider: AIProviderName | null;
  providers: AIProviderStatus[];
}

export interface AIProviderValidationResponse {
  provider: AIProviderName;
  valid: boolean;
  source: 'input' | 'env' | 'none';
  message: string;
}

export interface DomDiffSummary {
  findingCount: number;
  similarity: number;
  topFindings: { type: string; severity: string; description: string }[];
  summary: Record<string, number>;
  findings?: DomDiffFinding[];
}

export interface DomDiffFinding {
  type: string;
  path: string;
  tag: string;
  severity: 'critical' | 'warning' | 'info';
  description: string;
  detail?: Record<string, unknown>;
}

export interface DomDiffStructured {
  findings: DomDiffFinding[];
  summary: Record<string, number>;
  similarity: number;
}

export interface CompareResult {
  diffUrl: string;
  diffFilename: string;
  pixelDiff: number;
  diffPercentage: number;
  ssimScore?: number;
  engineResults?: EngineResultInfo[];
  phash?: {
    similarity: number;
    baselineHash: string;
    testHash: string;
  };
  domDiff?: DomDiffSummary;
}

export interface EngineResultInfo {
  engine: string;
  similarity: number;
  diffPercent: number;
  diffPixels?: number;
  error?: string;
}

export interface ImageResult {
  status: 'passed' | 'failed' | 'new';
  confidence?: { score: number; pass: boolean; verdict: 'pass' | 'warn' | 'fail' };
  metrics?: { pixelDiff: number; diffPercentage: number; ssimScore?: number };
  engineResults?: EngineResultInfo[];
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

export interface ConfigValidationIssue {
  path: string;
  message: string;
}

export interface ConfigGetResponse {
  config: unknown;
  raw: unknown;
  valid: boolean;
  errors: ConfigValidationIssue[] | null;
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
  engineResults?: EngineResultInfo[];
  phash?: {
    similarity: number;
    baselineHash: string;
    testHash: string;
  };
  domSnapshot?: {
    enabled: boolean;
    baselineFound: boolean;
    testFound: boolean;
  };
  domDiff?: DomDiffStructured;
  error?: string;
  accepted?: boolean;
  acceptedAt?: string;
  flagged?: boolean;
  flaggedAt?: string;
  aiAnalysis?: AIAnalysisResult;
  smartPass?: boolean;
  smartPassReason?: string;
  outdated?: boolean;
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
  flaggedCount: number;
  outdatedCount?: number;
}

export interface CrossAcceptance {
  itemKey: string;
  acceptedAt: string;
  reason?: string;
}

export interface CrossFlag {
  itemKey: string;
  flaggedAt: string;
  reason?: string;
}

export interface CrossCompareStartResponse {
  jobId: string;
  status: 'running';
  phase: 'preparing' | 'running' | 'done';
  progress: number;
  total: number;
  pairIndex: number;
  pairTotal: number;
  currentPairKey?: string;
  currentPairTitle?: string;
  startedAt: string;
}

export interface CrossCompareStatusResponse {
  id: string;
  status: 'running' | 'completed' | 'failed';
  phase: 'preparing' | 'running' | 'done';
  progress: number;
  total: number;
  pairIndex: number;
  pairTotal: number;
  currentPairKey?: string;
  currentPairTitle?: string;
  reports: CrossReport[];
  error?: string;
  startedAt: string;
  completedAt?: string;
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
  concurrency?: number; // Parallel page concurrency (1-20, default: 5)
  confidence?: {
    passThreshold?: number;
    warnThreshold?: number;
  };
  scenarioDefaults?: ScenarioOptions; // Default options for all scenarios
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
