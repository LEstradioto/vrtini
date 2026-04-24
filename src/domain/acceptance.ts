/**
 * Acceptance + image-flag data shapes. Pure types, no I/O.
 */

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

// ─── Cross-compare variants ─────────────────────────────────────────────────
// These are the cross-compare-specific acceptance/flag records, keyed by
// `${pairKey}::${itemKey}` rather than by filename.

export interface CrossAcceptanceRecord {
  acceptedAt: string;
  reason?: string;
}

export interface CrossFlagRecord {
  flaggedAt: string;
  reason?: string;
}
