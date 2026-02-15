export type ImageStatus = 'passed' | 'failed' | 'new';

export interface GalleryImage {
  filename: string;
  status: ImageStatus;
  flagged?: boolean;
  confidence?: { score: number; pass: boolean; verdict: 'pass' | 'warn' | 'fail' };
  metrics?: {
    pixelDiff: number;
    diffPercentage: number;
    ssimScore?: number;
    phash?: { similarity: number };
  };
}

export interface ImageInfo {
  src: string;
  label: string;
  updatedAt?: string;
}

export interface CompareImages {
  left: ImageInfo;
  right: ImageInfo;
  diff?: ImageInfo;
}

export interface CompareMetrics {
  pixelDiff: number;
  diffPercentage: number;
  ssimScore?: number;
  engineResults?: Array<{
    engine: string;
    similarity: number;
    diffPercent: number;
    diffPixels?: number;
    error?: string;
  }>;
  phash?: { similarity: number };
}

export interface CompareDomDiffFinding {
  type: string;
  path: string;
  tag: string;
  severity: 'critical' | 'warning' | 'info';
  description: string;
  detail?: Record<string, unknown>;
}

export interface CompareDomDiff {
  similarity: number;
  summary: Record<string, number>;
  findings?: CompareDomDiffFinding[];
  findingCount?: number;
  topFindings?: { type: string; severity: string; description: string }[];
}

export interface CompareQueueItem {
  images: CompareImages;
  title: string;
  metrics?: CompareMetrics;
  accepted?: boolean;
  badge?: {
    label: string;
    tone: 'approved' | 'smart' | 'passed' | 'diff' | 'unapproved' | 'issue' | 'flagged';
  };
  flagged?: boolean;
  viewport?: string;
  aiRecommendation?: 'approve' | 'review' | 'reject';
  aiCategory?: string;
  aiConfidence?: number;
  domSnapshotStatus?: {
    enabled: boolean;
    baselineFound: boolean;
    testFound: boolean;
  };
  domDiff?: CompareDomDiff;
}

export type ColumnMode =
  | 'auto'
  | '1'
  | '2'
  | '3'
  | '4'
  | '5'
  | '6'
  | '7'
  | '8'
  | '9'
  | '10'
  | '11'
  | '12'
  | '13'
  | '14'
  | '15';
