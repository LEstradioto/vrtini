/**
 * Cross-compare pair generation: combinatorial over configured browsers.
 * Prefers unversioned (latest) as baseline; dedups and skips self-pairs.
 * Pure — no I/O.
 */

import { normalizeBrowserConfig } from '../browser-versions.js';
import { formatBrowser, type BrowserRef } from '../types/index.js';

export interface CrossComparePair {
  key: string;
  title: string;
  baseline: BrowserRef;
  test: BrowserRef;
}

export function buildCrossComparePairs(
  browsers: (string | { name: 'chromium' | 'webkit'; version?: string })[]
): CrossComparePair[] {
  const all = browsers.map(normalizeBrowserConfig);
  const pairs: CrossComparePair[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      const a = all[i];
      const b = all[j];

      // Skip identical entries (same name and version)
      if (a.name === b.name && a.version === b.version) continue;

      // Baseline preference: unversioned (latest) over versioned (old)
      let baseline = a;
      let test = b;
      if (a.version && !b.version) {
        baseline = b;
        test = a;
      }

      const key = `${formatBrowser(baseline)}_vs_${formatBrowser(test)}`;
      if (seen.has(key)) continue;
      seen.add(key);

      pairs.push({
        key,
        title: `Cross Compare: ${formatBrowser(baseline)} vs ${formatBrowser(test)}`,
        baseline,
        test,
      });
    }
  }

  return pairs;
}
