export type ImageStatus = 'passed' | 'failed' | 'new';

export interface GalleryImage {
  filename: string;
  status: ImageStatus;
  confidence?: { score: number; pass: boolean; verdict: 'pass' | 'warn' | 'fail' };
  metrics?: { pixelDiff: number; diffPercentage: number; ssimScore?: number };
}

export interface ImageInfo {
  src: string;
  label: string;
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
  phash?: { similarity: number };
}

export interface CompareQueueItem {
  images: CompareImages;
  title: string;
  metrics?: CompareMetrics;
  accepted?: boolean;
  badge?: {
    label: string;
    tone: 'approved' | 'smart' | 'passed' | 'diff' | 'unapproved' | 'issue';
  };
  viewport?: string;
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
