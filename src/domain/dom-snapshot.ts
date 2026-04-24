/**
 * DOM snapshot types for structured DOM capture.
 */

export interface SnapshotElementBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SnapshotElementStyles {
  color?: string;
  backgroundColor?: string;
  fontSize?: string;
  fontFamily?: string;
  fontWeight?: string;
  lineHeight?: string;
  padding?: string;
  margin?: string;
  borderWidth?: string;
  borderColor?: string;
  display?: string;
  position?: string;
  opacity?: string;
}

export interface SnapshotElement {
  path: string; // CSS selector
  tag: string;
  box: SnapshotElementBox;
  text?: string; // direct text nodes only
  styles: SnapshotElementStyles;
  children: number[]; // indices into flat array
  id?: string;
  testId?: string; // data-testid
}

export interface DomSnapshot {
  version: 1;
  viewport: { width: number; height: number };
  scrollSize: { width: number; height: number };
  elements: SnapshotElement[];
  capturedAt: string;
}

// ─── DOM diff types ─────────────────────────────────────────────────────────
// Produced by `src/engines/dom-diff.ts` but declared here so downstream
// domain modules (classification, smart-pass, cross-summary) depend only on
// the pure domain layer and not on engines/.

export type FindingType =
  | 'text_changed'
  | 'text_moved'
  | 'layout_shift'
  | 'spacing_change'
  | 'style_change'
  | 'background_change'
  | 'element_added'
  | 'element_removed';

export type FindingSeverity = 'critical' | 'warning' | 'info';

export interface DomFinding {
  type: FindingType;
  path: string;
  tag: string;
  severity: FindingSeverity;
  description: string;
  detail?: Record<string, unknown>;
}

export interface DomDiffResult {
  findings: DomFinding[];
  summary: Record<FindingType, number>;
  similarity: number; // 0-1
}
