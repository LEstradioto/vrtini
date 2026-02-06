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
