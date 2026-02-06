/**
 * DOM diff engine - compares two DOM snapshots to produce structured findings.
 * Pure functions, no I/O.
 */

import type { DomSnapshot, SnapshotElement, SnapshotElementBox } from '../domain/dom-snapshot.js';

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

interface MatchedPair {
  baseline: SnapshotElement;
  test: SnapshotElement;
}

// --- Element matching ---

function matchKey(el: SnapshotElement): string {
  if (el.testId) return `testid:${el.testId}`;
  if (el.id) return `id:${el.id}`;
  return `path:${el.path}`;
}

function positionKey(el: SnapshotElement): string {
  return `${el.tag}:${Math.round(el.box.x / 20)}:${Math.round(el.box.y / 20)}`;
}

function matchElements(
  baselineEls: SnapshotElement[],
  testEls: SnapshotElement[]
): { matched: MatchedPair[]; added: SnapshotElement[]; removed: SnapshotElement[] } {
  const matched: MatchedPair[] = [];
  const testByKey = new Map<string, SnapshotElement>();
  const testByPos = new Map<string, SnapshotElement>();
  const matchedTestIndices = new Set<number>();

  // Build test lookup maps
  for (const el of testEls) {
    testByKey.set(matchKey(el), el);
    testByPos.set(positionKey(el), el);
  }

  // Match baseline elements to test elements
  const matchedBaselineIndices = new Set<number>();
  for (let i = 0; i < baselineEls.length; i++) {
    const bEl = baselineEls[i];
    const key = matchKey(bEl);

    // Primary: match by key (path / id / testid)
    let tEl = testByKey.get(key);

    // Fallback: match by tag + approximate position
    if (!tEl) {
      tEl = testByPos.get(positionKey(bEl));
      if (tEl && tEl.tag !== bEl.tag) tEl = undefined;
    }

    if (tEl) {
      const tIdx = testEls.indexOf(tEl);
      if (!matchedTestIndices.has(tIdx)) {
        matched.push({ baseline: bEl, test: tEl });
        matchedBaselineIndices.add(i);
        matchedTestIndices.add(tIdx);
      }
    }
  }

  const removed = baselineEls.filter((_, i) => !matchedBaselineIndices.has(i));
  const added = testEls.filter((_, i) => !matchedTestIndices.has(i));

  return { matched, added, removed };
}

// --- Box / style comparison helpers ---

function boxDelta(a: SnapshotElementBox, b: SnapshotElementBox): number {
  return Math.max(
    Math.abs(a.x - b.x),
    Math.abs(a.y - b.y),
    Math.abs(a.w - b.w),
    Math.abs(a.h - b.h)
  );
}

function layoutShiftSeverity(delta: number): FindingSeverity {
  if (delta > 20) return 'critical';
  if (delta > 5) return 'warning';
  return 'info';
}

const SPACING_PROPS = ['padding', 'margin'] as const;
const BACKGROUND_PROPS = ['backgroundColor'] as const;
const STYLE_PROPS_TO_CHECK = [
  'color',
  'fontSize',
  'fontFamily',
  'fontWeight',
  'lineHeight',
  'borderWidth',
  'borderColor',
  'display',
  'position',
  'opacity',
] as const;

function isInViewport(el: SnapshotElement, viewport: { width: number; height: number }): boolean {
  return el.box.y < viewport.height && el.box.x < viewport.width;
}

// --- Finding generation ---

function compareMatchedPair(pair: MatchedPair): DomFinding[] {
  const findings: DomFinding[] = [];
  const { baseline: b, test: t } = pair;

  // 1. Text changes
  if (b.text !== t.text) {
    if (b.text && t.text) {
      // Text content differs
      findings.push({
        type: 'text_changed',
        path: b.path,
        tag: b.tag,
        severity: 'warning',
        description: `Text changed: "${truncate(b.text, 40)}" -> "${truncate(t.text, 40)}"`,
        detail: { from: b.text, to: t.text },
      });
    } else if (!b.text && t.text) {
      findings.push({
        type: 'text_changed',
        path: b.path,
        tag: b.tag,
        severity: 'warning',
        description: `Text added: "${truncate(t.text, 40)}"`,
        detail: { from: null, to: t.text },
      });
    } else if (b.text && !t.text) {
      findings.push({
        type: 'text_changed',
        path: b.path,
        tag: b.tag,
        severity: 'warning',
        description: `Text removed: "${truncate(b.text, 40)}"`,
        detail: { from: b.text, to: null },
      });
    }
  } else if (b.text && t.text && b.text === t.text) {
    // Same text, different box = text moved
    const delta = boxDelta(b.box, t.box);
    if (delta > 2) {
      findings.push({
        type: 'text_moved',
        path: b.path,
        tag: b.tag,
        severity: layoutShiftSeverity(delta),
        description: `Text moved by ${delta}px: "${truncate(b.text, 30)}"`,
        detail: { from: b.box, to: t.box, delta },
      });
    }
  }

  // 2. Layout shift (box position/size)
  const delta = boxDelta(b.box, t.box);
  if (delta > 2 && !(b.text && t.text && b.text === t.text)) {
    // Don't duplicate text_moved findings
    findings.push({
      type: 'layout_shift',
      path: b.path,
      tag: b.tag,
      severity: layoutShiftSeverity(delta),
      description: `Layout shifted by ${delta}px on <${b.tag}>`,
      detail: { from: b.box, to: t.box, delta },
    });
  }

  // 3. Spacing changes
  for (const prop of SPACING_PROPS) {
    const bVal = b.styles[prop];
    const tVal = t.styles[prop];
    if (bVal && tVal && bVal !== tVal) {
      const numDelta = parseSpacingDelta(bVal, tVal);
      findings.push({
        type: 'spacing_change',
        path: b.path,
        tag: b.tag,
        severity: numDelta !== undefined && numDelta < 3 ? 'info' : 'warning',
        description: `${prop} changed: ${bVal} -> ${tVal}`,
        detail: { property: prop, from: bVal, to: tVal },
      });
    }
  }

  // 4. Background changes
  for (const prop of BACKGROUND_PROPS) {
    const bVal = b.styles[prop];
    const tVal = t.styles[prop];
    if (bVal && tVal && bVal !== tVal) {
      findings.push({
        type: 'background_change',
        path: b.path,
        tag: b.tag,
        severity: 'warning',
        description: `Background changed on <${b.tag}>: ${bVal} -> ${tVal}`,
        detail: { from: bVal, to: tVal },
      });
    }
  }

  // 5. Other style diffs
  for (const prop of STYLE_PROPS_TO_CHECK) {
    const bVal = b.styles[prop as keyof typeof b.styles];
    const tVal = t.styles[prop as keyof typeof t.styles];
    if (bVal && tVal && bVal !== tVal) {
      findings.push({
        type: 'style_change',
        path: b.path,
        tag: b.tag,
        severity: 'info',
        description: `${prop} changed: ${bVal} -> ${tVal}`,
        detail: { property: prop, from: bVal, to: tVal },
      });
    }
  }

  return findings;
}

function truncate(str: string, max: number): string {
  return str.length > max ? str.slice(0, max) + '...' : str;
}

function parseSpacingDelta(a: string, b: string): number | undefined {
  const aNum = parseFloat(a);
  const bNum = parseFloat(b);
  if (isNaN(aNum) || isNaN(bNum)) return undefined;
  return Math.abs(aNum - bNum);
}

// --- Main comparison ---

export function compareDomSnapshots(baseline: DomSnapshot, test: DomSnapshot): DomDiffResult {
  const { matched, added, removed } = matchElements(baseline.elements, test.elements);

  const findings: DomFinding[] = [];

  // Compare matched pairs
  for (const pair of matched) {
    findings.push(...compareMatchedPair(pair));
  }

  // Added elements
  for (const el of added) {
    const inView = isInViewport(el, test.viewport);
    findings.push({
      type: 'element_added',
      path: el.path,
      tag: el.tag,
      severity: inView ? 'critical' : 'warning',
      description: `Element added: <${el.tag}>${el.text ? ` "${truncate(el.text, 30)}"` : ''}`,
      detail: { box: el.box },
    });
  }

  // Removed elements
  for (const el of removed) {
    const inView = isInViewport(el, baseline.viewport);
    findings.push({
      type: 'element_removed',
      path: el.path,
      tag: el.tag,
      severity: inView ? 'critical' : 'warning',
      description: `Element removed: <${el.tag}>${el.text ? ` "${truncate(el.text, 30)}"` : ''}`,
      detail: { box: el.box },
    });
  }

  // Build summary counts
  const summary: Record<FindingType, number> = {
    text_changed: 0,
    text_moved: 0,
    layout_shift: 0,
    spacing_change: 0,
    style_change: 0,
    background_change: 0,
    element_added: 0,
    element_removed: 0,
  };
  for (const f of findings) {
    summary[f.type]++;
  }

  // Calculate similarity: ratio of matched elements without findings
  const totalElements = Math.max(baseline.elements.length, test.elements.length, 1);
  const unchangedMatched = matched.filter((pair) => compareMatchedPair(pair).length === 0).length;
  const similarity = totalElements > 0 ? unchangedMatched / totalElements : 1;

  return { findings, summary, similarity };
}
