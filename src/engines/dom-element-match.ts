/**
 * Element matching for DOM diff: pair up baseline and test snapshot elements
 * by stable id/testId/path, with a tag+approximate-position fallback. Pure;
 * split out of dom-diff.ts so the matching primitives can be tested
 * independently of the per-pair finding generator.
 */

import type { SnapshotElement } from '../domain/dom-snapshot.js';

export interface MatchedPair {
  baseline: SnapshotElement;
  test: SnapshotElement;
}

function matchKey(el: SnapshotElement): string {
  if (el.testId) return `testid:${el.testId}`;
  if (el.id) return `id:${el.id}`;
  return `path:${el.path}`;
}

function positionKey(el: SnapshotElement): string {
  return `${el.tag}:${Math.round(el.box.x / 20)}:${Math.round(el.box.y / 20)}`;
}

export function matchElements(
  baselineEls: SnapshotElement[],
  testEls: SnapshotElement[]
): { matched: MatchedPair[]; added: SnapshotElement[]; removed: SnapshotElement[] } {
  const matched: MatchedPair[] = [];
  const testByKey = new Map<string, SnapshotElement>();
  const testByPos = new Map<string, SnapshotElement>();
  const matchedTestIndices = new Set<number>();

  for (const el of testEls) {
    testByKey.set(matchKey(el), el);
    testByPos.set(positionKey(el), el);
  }

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
