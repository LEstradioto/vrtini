/**
 * Reactive store for Project page business logic.
 *
 * Owns: image status calculations, tag filtering, auto-threshold review,
 * gallery queue building, metadata/config map derivations.
 *
 * Does NOT own: UI state (modals, pagination, search, selection).
 */
import type {
  ImageMetadata,
  Acceptance,
  ImageFlag,
  ImageResult,
  AutoThresholdCaps,
  VRTConfig,
} from '../../../shared/api-types.js';

// ── Types ────────────────────────────────────────────────────────────────────

export type ImageStatus = 'passed' | 'failed' | 'new';
export type ImageTag =
  | 'all'
  | 'passed'
  | 'failed'
  | 'new'
  | 'flagged'
  | 'approved'
  | 'unapproved'
  | 'diff'
  | 'auto-review';
export type ImageType = 'baseline' | 'test' | 'diff';

type DiffThreshold = { maxDiffPercentage?: number; maxDiffPixels?: number };

export type AutoThresholdReviewItem = {
  filename: string;
  scenario?: string;
  viewport?: string;
  diffPercentage: number;
  pixelDiff?: number;
  baseMaxDiffPercentage?: number;
  baseMaxDiffPixels?: number;
  autoMaxDiffPercentage?: number;
  autoMaxDiffPixels?: number;
};

export type GalleryImage = {
  filename: string;
  status: ImageStatus;
  flagged?: boolean;
  confidence?: { score: number; pass: boolean; verdict: 'pass' | 'warn' | 'fail' };
  metrics?: { pixelDiff: number; diffPercentage: number; ssimScore?: number };
};

// ── Pure helpers (no reactive state) ─────────────────────────────────────────

function hasDiffThreshold(threshold?: DiffThreshold | null): boolean {
  return (
    !!threshold &&
    (threshold.maxDiffPercentage !== undefined || threshold.maxDiffPixels !== undefined)
  );
}

function buildAutoThresholdKey(scenario?: string, viewport?: string): string | null {
  const s = scenario?.trim();
  const v = viewport?.trim();
  if (!s || !v) return null;
  return `${s}::${v}`;
}

// ── Store class ──────────────────────────────────────────────────────────────

export class ProjectStore {
  // Raw data — set from outside after API loads
  baselines = $state<string[]>([]);
  tests = $state<string[]>([]);
  diffs = $state<string[]>([]);
  baselinesMetadata = $state<ImageMetadata[]>([]);
  testsMetadata = $state<ImageMetadata[]>([]);
  diffsMetadata = $state<ImageMetadata[]>([]);
  acceptances = $state<Record<string, Acceptance>>({});
  flags = $state<Record<string, ImageFlag>>({});
  imageResults = $state<Record<string, ImageResult>>({});
  autoThresholdCaps = $state<AutoThresholdCaps | null>(null);
  configData = $state<VRTConfig | null>(null);

  // ── Derived: lookup Sets & counts (single pass) ──────────────────────────

  #imageCounts = $derived.by(() => {
    const bSet = new Set(this.baselines);
    const tSet = new Set(this.tests);
    const dSet = new Set(this.diffs);
    const missingTests: string[] = [];
    let newN = 0;
    let passedN = 0;
    let missingN = 0;
    for (const b of this.baselines) {
      if (!tSet.has(b)) {
        missingN++;
        missingTests.push(b);
      }
    }
    for (const t of this.tests) {
      if (!bSet.has(t)) newN++;
      else if (!dSet.has(t)) passedN++;
    }
    return {
      baselinesSet: bSet,
      testsSet: tSet,
      diffsSet: dSet,
      newCount: newN,
      passedCount: passedN,
      missingTestCount: missingN,
      missingTests,
    };
  });

  baselinesSet = $derived(this.#imageCounts.baselinesSet);
  testsSet = $derived(this.#imageCounts.testsSet);
  diffsSet = $derived(this.#imageCounts.diffsSet);
  newCount = $derived(this.#imageCounts.newCount);
  passedCount = $derived(this.#imageCounts.passedCount);
  missingTestCount = $derived(this.#imageCounts.missingTestCount);
  missingTests = $derived(this.#imageCounts.missingTests);
  totalCount = $derived(Math.max(this.tests.length, this.baselines.length));
  totalTab = $derived<'tests' | 'baselines'>(
    this.tests.length >= this.baselines.length ? 'tests' : 'baselines'
  );
  failedCount = $derived(this.diffs.length);

  // ── Derived: metadata maps ───────────────────────────────────────────────

  baselineMetadataMap = $derived.by(
    () => new Map(this.baselinesMetadata.map((m) => [m.filename, m]))
  );
  testMetadataMap = $derived.by(() => new Map(this.testsMetadata.map((m) => [m.filename, m])));
  diffsMetadataMap = $derived.by(() => new Map(this.diffsMetadata.map((m) => [m.filename, m])));

  // ── Derived: config maps ─────────────────────────────────────────────────

  #configMaps = $derived.by(() => {
    const vMap = new Map((this.configData?.viewports ?? []).map((v) => [v.name, v] as const));
    const sMap = new Map(
      (this.configData?.scenarios ?? []).map((s) => [s.name.trim(), s.diffThreshold ?? {}] as const)
    );
    return { viewportMap: vMap, scenarioThresholdMap: sMap };
  });

  viewportMap = $derived(this.#configMaps.viewportMap);
  scenarioThresholdMap = $derived(this.#configMaps.scenarioThresholdMap);

  // ── Derived: auto-threshold review ───────────────────────────────────────

  autoThresholdReviewItems = $derived.by<AutoThresholdReviewItem[]>(() => {
    if (!this.configData?.autoThresholds?.enabled) return [];
    if (!this.autoThresholdCaps) return [];

    const items: AutoThresholdReviewItem[] = [];

    for (const filename of this.diffs) {
      const meta = this.diffsMetadataMap.get(filename);
      if (!meta) continue;
      const metrics = this.imageResults[filename]?.metrics;
      if (!metrics || !Number.isFinite(metrics.diffPercentage)) continue;

      const baseThreshold = this.resolveBaseDiffThreshold(meta);
      if (!hasDiffThreshold(baseThreshold)) continue;

      const key = buildAutoThresholdKey(meta.scenario, meta.viewport);
      if (!key) continue;

      const cap = this.autoThresholdCaps!.caps[key];
      if (!cap) continue;

      const baseMaxDiffPercentage = baseThreshold?.maxDiffPercentage;
      const baseMaxDiffPixels = baseThreshold?.maxDiffPixels;
      const diffPercentage = metrics.diffPercentage;
      const pixelDiff = metrics.pixelDiff;
      const autoMaxDiffPercentage = cap.p95DiffPercentage;
      const autoMaxDiffPixels = cap.p95PixelDiff;

      let qualifies = false;

      if (
        baseMaxDiffPercentage !== undefined &&
        autoMaxDiffPercentage !== undefined &&
        autoMaxDiffPercentage > baseMaxDiffPercentage &&
        diffPercentage > baseMaxDiffPercentage &&
        diffPercentage <= autoMaxDiffPercentage
      ) {
        qualifies = true;
      }

      if (
        !qualifies &&
        baseMaxDiffPixels !== undefined &&
        autoMaxDiffPixels !== undefined &&
        typeof pixelDiff === 'number' &&
        Number.isFinite(pixelDiff) &&
        autoMaxDiffPixels > baseMaxDiffPixels &&
        pixelDiff > baseMaxDiffPixels &&
        pixelDiff <= autoMaxDiffPixels
      ) {
        qualifies = true;
      }

      if (!qualifies) continue;

      items.push({
        filename,
        scenario: meta.scenario,
        viewport: meta.viewport,
        diffPercentage,
        pixelDiff,
        baseMaxDiffPercentage,
        baseMaxDiffPixels,
        autoMaxDiffPercentage,
        autoMaxDiffPixels,
      });
    }

    return items.sort((a, b) => b.diffPercentage - a.diffPercentage);
  });

  autoThresholdReviewSet = $derived.by(
    () => new Set(this.autoThresholdReviewItems.map((i) => i.filename))
  );

  autoThresholdReviewCount = $derived(this.autoThresholdReviewItems.length);

  // ── Derived: gallery queue ───────────────────────────────────────────────

  galleryQueue = $derived.by((): GalleryImage[] => {
    const failed: GalleryImage[] = [];
    const newImages: GalleryImage[] = [];
    const passed: GalleryImage[] = [];

    for (const filename of this.tests) {
      const status = this.getImageStatus(filename);
      const result = this.imageResults[filename];
      const item: GalleryImage = {
        filename,
        status: status || 'passed',
        flagged: !!this.flags[filename],
        confidence: result?.confidence,
        metrics: result?.metrics,
      };
      if (status === 'failed') failed.push(item);
      else if (status === 'new') newImages.push(item);
      else if (status === 'passed') passed.push(item);
    }

    return [...failed, ...newImages, ...passed];
  });

  // ── Methods: status & tagging ────────────────────────────────────────────

  getImageStatus(filename: string): ImageStatus | null {
    if (this.diffsSet.has(filename)) return 'failed';
    if (this.testsSet.has(filename) && !this.baselinesSet.has(filename)) return 'new';
    if (this.testsSet.has(filename) && this.baselinesSet.has(filename)) return 'passed';
    return null;
  }

  getTagFor(filename: string, activeTab: string): ImageTag {
    if (this.flags[filename]) return 'flagged';
    if (activeTab === 'diffs') {
      return this.autoThresholdReviewSet.has(filename) ? 'auto-review' : 'diff';
    }
    if (this.acceptances[filename]) return 'approved';
    const status = this.getImageStatus(filename);
    if (status === 'failed') return 'unapproved';
    if (status === 'new') return 'new';
    if (status === 'passed') return 'passed';
    return 'all';
  }

  matchesTag(filename: string, tag: ImageTag, activeTab: string): boolean {
    if (tag === 'all') return true;
    if (tag === 'flagged') {
      return !!this.flags[filename];
    }
    if (tag === 'approved') {
      return !!this.acceptances[filename];
    }
    if (tag === 'auto-review') {
      return this.autoThresholdReviewSet.has(filename);
    }
    if (tag === 'diff') {
      return this.diffsSet.has(filename);
    }

    const status = this.getImageStatus(filename);
    if (tag === 'failed') {
      return status === 'failed';
    }
    if (tag === 'unapproved') {
      return status === 'failed';
    }
    if (tag === 'new') {
      return status === 'new';
    }
    if (tag === 'passed') {
      return status === 'passed';
    }

    const fileTag = this.getTagFor(filename, activeTab);
    return fileTag === tag;
  }

  matchesTagSet(filename: string, tags: Set<ImageTag>, activeTab: string): boolean {
    if (tags.has('all')) return true;
    for (const tag of tags) {
      if (this.matchesTag(filename, tag, activeTab)) return true;
    }
    return false;
  }

  // ── Methods: metadata helpers ────────────────────────────────────────────

  getMetadataForType(type: ImageType, filename: string): ImageMetadata | null {
    if (type === 'baseline') return this.baselineMetadataMap.get(filename) ?? null;
    if (type === 'test') return this.testMetadataMap.get(filename) ?? null;
    if (type === 'diff') return this.diffsMetadataMap.get(filename) ?? null;
    return null;
  }

  activeMetadata(activeTab: string): ImageMetadata[] {
    switch (activeTab) {
      case 'baselines':
        return this.baselinesMetadata;
      case 'tests':
        return this.testsMetadata;
      case 'diffs':
        return this.diffsMetadata;
      default:
        return [];
    }
  }

  // ── Methods: threshold helpers ───────────────────────────────────────────

  resolveBaseDiffThreshold(meta?: ImageMetadata | null): DiffThreshold | null {
    if (!this.configData) return null;
    const scenario = meta?.scenario?.trim();
    const scenarioThreshold = scenario ? this.scenarioThresholdMap.get(scenario) : undefined;
    if (hasDiffThreshold(scenarioThreshold)) return scenarioThreshold ?? null;
    if (hasDiffThreshold(this.configData.diffThreshold))
      return this.configData.diffThreshold ?? null;
    return null;
  }

  // ── Methods: filtered gallery queue (needs activeTab + tagFilter) ──────

  filteredGalleryQueue(activeTab: string, tagFilter: Set<ImageTag>): GalleryImage[] {
    if (activeTab === 'diffs') return this.galleryQueue.filter((item) => item.status === 'failed');
    if (tagFilter.has('all')) return this.galleryQueue;
    return this.galleryQueue.filter((item) =>
      this.matchesTagSet(item.filename, tagFilter, activeTab)
    );
  }

  // ── Methods: raw list (needs activeTab + tagFilter) ────────────────────

  rawList(activeTab: string, tagFilter: Set<ImageTag>): string[] {
    let list: string[];
    switch (activeTab) {
      case 'baselines':
        list = this.baselines;
        break;
      case 'tests':
        list = this.tests;
        break;
      case 'diffs':
        list = this.diffs;
        break;
      case 'compare':
        return [];
      case 'cross':
        return [];
      default:
        return [];
    }
    if (tagFilter.has('all')) return list;
    return list.filter((f) => this.matchesTagSet(f, tagFilter, activeTab));
  }
}
