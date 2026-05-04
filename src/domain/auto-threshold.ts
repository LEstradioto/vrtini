/**
 * Auto-thresholds: derive per-(scenario, viewport) diff caps from historical
 * user-approved variance. Pure — operates on plain records, no I/O.
 */

import type { Acceptance } from './acceptance.js';
import { parseImageFilename, UNKNOWN_COMPONENT } from './image-naming.js';
import type { VRTConfig } from '../core/config.js';

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

const DEFAULT_PERCENTILE = 0.95;
const DEFAULT_MIN_SAMPLE_SIZE = 5;

function percentileNearestRank(values: number[], percentile: number): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil(percentile * sorted.length);
  const index = Math.min(sorted.length - 1, Math.max(0, rank - 1));
  return sorted[index];
}

function normalizeGroupComponent(value?: string): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed || trimmed === UNKNOWN_COMPONENT) return undefined;
  return trimmed;
}

function getAcceptanceGroupKey(
  acceptance: Acceptance
): { key: string; scenario: string; viewport: string } | null {
  let scenario = normalizeGroupComponent(acceptance.signals?.scenario);
  let viewport = normalizeGroupComponent(acceptance.signals?.viewport);

  if (!scenario || !viewport) {
    const parsed = parseImageFilename(acceptance.filename);
    scenario = scenario ?? normalizeGroupComponent(parsed.scenario);
    viewport = viewport ?? normalizeGroupComponent(parsed.viewport);
  }

  if (!scenario || !viewport) return null;
  return { key: `${scenario}::${viewport}`, scenario, viewport };
}

export function computeAutoThresholdCaps(
  acceptances: Acceptance[],
  options: { percentile?: number; minSampleSize?: number } = {}
): AutoThresholdCaps {
  const percentile = options.percentile ?? DEFAULT_PERCENTILE;
  const minSampleSize = options.minSampleSize ?? DEFAULT_MIN_SAMPLE_SIZE;

  interface GroupAccumulator {
    scenario: string;
    viewport: string;
    diffPercentages: number[];
    pixelDiffs: number[];
  }

  const groups = new Map<string, GroupAccumulator>();

  for (const acceptance of acceptances) {
    const groupKey = getAcceptanceGroupKey(acceptance);
    if (!groupKey) continue;
    const diffPercentage = acceptance.metrics.diffPercentage;
    if (!Number.isFinite(diffPercentage)) continue;

    const group =
      groups.get(groupKey.key) ??
      ({
        scenario: groupKey.scenario,
        viewport: groupKey.viewport,
        diffPercentages: [],
        pixelDiffs: [],
      } satisfies GroupAccumulator);

    group.diffPercentages.push(diffPercentage);

    const pixelDiff = acceptance.metrics.pixelDiff;
    if (typeof pixelDiff === 'number' && Number.isFinite(pixelDiff)) {
      group.pixelDiffs.push(pixelDiff);
    }

    groups.set(groupKey.key, group);
  }

  const caps: Record<string, AutoThresholdCap> = {};

  for (const [key, group] of groups) {
    if (group.diffPercentages.length < minSampleSize) continue;

    const p95DiffPercentage = percentileNearestRank(group.diffPercentages, percentile);
    if (p95DiffPercentage === undefined) continue;

    const cap: AutoThresholdCap = {
      scenario: group.scenario,
      viewport: group.viewport,
      sampleSize: group.diffPercentages.length,
      p95DiffPercentage,
    };

    if (group.pixelDiffs.length >= minSampleSize) {
      const p95PixelDiff = percentileNearestRank(group.pixelDiffs, percentile);
      if (p95PixelDiff !== undefined) {
        cap.p95PixelDiff = p95PixelDiff;
        cap.pixelSampleSize = group.pixelDiffs.length;
      }
    }

    caps[key] = cap;
  }

  return { percentile, minSampleSize, caps };
}

// ─── Per-scenario threshold resolution ──────────────────────────────────────

/**
 * Stable key used to pair an auto-threshold cap with a scenario × viewport
 * combination. Trimmed so trailing whitespace in the config doesn't split
 * caps.
 */
export function buildAutoThresholdKey(scenarioName: string, viewportName: string): string {
  return `${scenarioName.trim()}::${viewportName.trim()}`;
}

function capAtCeiling(value: number | undefined, ceiling: number | undefined): number | undefined {
  if (value === undefined) return undefined;
  if (ceiling === undefined) return value;
  return Math.min(value, ceiling);
}

/**
 * Resolve the effective diff thresholds for one (scenario, viewport).
 *
 * Precedence: scenario.diffThreshold → config.diffThreshold → undefined.
 * If `autoThresholdCaps` has a p95 cap for this (scenario, viewport), it is
 * applied as a *ceiling* on the user-supplied threshold (never raises it).
 */
export function resolveDiffThresholds(
  scenario: VRTConfig['scenarios'][number],
  viewport: VRTConfig['viewports'][number],
  config: VRTConfig,
  autoThresholdCaps: AutoThresholdCaps | null
): { maxDiffPercentage?: number; maxDiffPixels?: number } {
  const baseMaxDiffPercentage =
    scenario.diffThreshold?.maxDiffPercentage ?? config.diffThreshold?.maxDiffPercentage;
  const baseMaxDiffPixels =
    scenario.diffThreshold?.maxDiffPixels ?? config.diffThreshold?.maxDiffPixels;

  if (!autoThresholdCaps) {
    return { maxDiffPercentage: baseMaxDiffPercentage, maxDiffPixels: baseMaxDiffPixels };
  }

  const cap = autoThresholdCaps.caps[buildAutoThresholdKey(scenario.name, viewport.name)];
  return {
    maxDiffPercentage:
      cap?.p95DiffPercentage !== undefined
        ? capAtCeiling(cap.p95DiffPercentage, baseMaxDiffPercentage)
        : baseMaxDiffPercentage,
    maxDiffPixels:
      cap?.p95PixelDiff !== undefined
        ? capAtCeiling(cap.p95PixelDiff, baseMaxDiffPixels)
        : baseMaxDiffPixels,
  };
}
