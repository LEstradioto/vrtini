<script lang="ts">
  import {
    projects,
    images,
    config,
    compare,
    acceptance,
    analyze,
    crossCompare,
    type Project as ProjectType,
    type ImageMetadata,
    type CompareResult,
    type AIAnalysisResult,
    type CrossResultItem,
    type CrossResults,
    type CrossResultsSummary,
  } from '../lib/api';
  import { getErrorMessage } from '../lib/errors';
  import { log } from '../lib/logger';
  import {
    ProjectStore,
    type GalleryImage,
    type ImageTag,
    type ImageType,
    type ImageStatus,
  } from '../lib/project-store.svelte';
  import CompareSelector from '../components/CompareSelector.svelte';
  import CompareResults from '../components/CompareResults.svelte';
  import CrossComparePanel from '../components/CrossComparePanel.svelte';
  import ImageGrid from '../components/ImageGrid.svelte';
  import BulkActionBar from '../components/BulkActionBar.svelte';
  import AIAnalysisModal from '../components/AIAnalysisModal.svelte';
  import FullscreenGallery from '../components/FullscreenGallery.svelte';
  import ProjectHeader from '../components/ProjectHeader.svelte';
  import type { CompareDomDiff } from '../components/gallery-types.js';

  import { getAppContext } from '../lib/app-context';
  import { DEFAULT_COMPARISON_THRESHOLD, PAGE_SIZE, CROSS_THUMB_MAX, SEARCH_DEBOUNCE_MS } from '../../../shared/constants';

  const {
    navigate,
    runningTests,
    startTest,
    abortTest,
    rerunImage,
    testErrors,
    clearTestError,
    testWarnings,
    clearTestWarning,
  } = getAppContext();

  let {
    projectId,
    initialTab,
  } = $props<{
    projectId: string;
    initialTab?: 'baselines' | 'tests' | 'diffs' | 'compare' | 'cross';
  }>();

  async function deleteProject() {
    const confirmed = confirm(
      'Remove this project from vrtini?\n\n' +
      '- The project will be removed from the dashboard\n' +
      '- All baseline, test, and diff images will be KEPT on disk\n' +
      '- You can re-add the project later'
    );
    if (!confirmed) return;

    try {
      await projects.delete(projectId);
      navigate('/');
    } catch (err) {
      error = getErrorMessage(err, 'Failed to remove project');
    }
  }

  function formatDuration(ms?: number): string {
    if (!ms) return '-';
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  }


  // CrossComparePanel component ref
  let crossPanel: ReturnType<typeof CrossComparePanel> | undefined = $state();

  function getCrossItemKey(item: CrossResultItem): string {
    return item.itemKey ?? `${item.scenario}__${item.viewport}`;
  }

  function getActiveCrossModalItem(): CrossResultItem | null {
    const state = crossPanel?.getCrossState();
    const filteredItems = state?.crossFilteredItems ?? [];
    if (filteredItems.length === 0) return null;
    const bounded = Math.max(0, Math.min(filteredItems.length - 1, crossQueueIndex));
    return filteredItems[bounded] ?? null;
  }

  function openCrossAIAnalysisModal(item?: CrossResultItem | null) {
    const target = item ?? currentCrossItem ?? getActiveCrossModalItem();
    if (!target?.aiAnalysis) {
      showToast('No AI analysis for this item yet. Run AI Triage first.', 'error');
      return;
    }
    analysisResults = [
      {
        filename: `${target.scenario} · ${target.viewport}`,
        analysis: target.aiAnalysis,
      },
    ];
    showAnalysisModal = true;
  }

  async function approveCrossFromModal() {
    if (!currentCrossItem || !crossPanel) return;
    const prevKey = getCrossItemKey(currentCrossItem);
    const prevIndex = crossQueueIndex;
    await crossPanel.approveCrossFromModal(currentCrossItem);
    syncCrossModalSelection(prevKey, prevIndex);
  }

  async function revokeCrossFromModal() {
    if (!currentCrossItem || !crossPanel) return;
    const prevKey = getCrossItemKey(currentCrossItem);
    const prevIndex = crossQueueIndex;
    await crossPanel.revokeCrossFromModal(currentCrossItem);
    syncCrossModalSelection(prevKey, prevIndex);
  }

  async function flagCrossFromModal() {
    if (!currentCrossItem || !crossPanel) return;
    const prevKey = getCrossItemKey(currentCrossItem);
    const prevIndex = crossQueueIndex;
    await crossPanel.flagCrossFromModal(currentCrossItem);
    syncCrossModalSelection(prevKey, prevIndex);
  }

  async function unflagCrossFromModal() {
    if (!currentCrossItem || !crossPanel) return;
    const prevKey = getCrossItemKey(currentCrossItem);
    const prevIndex = crossQueueIndex;
    await crossPanel.unflagCrossFromModal(currentCrossItem);
    syncCrossModalSelection(prevKey, prevIndex);
  }

  async function runCrossAITriageFromModal() {
    if (!currentCrossItem || !crossPanel) return;
    const prevKey = getCrossItemKey(currentCrossItem);
    const prevIndex = crossQueueIndex;
    await crossPanel.runAITriage([prevKey]);
    syncCrossModalSelection(prevKey, prevIndex);
    const refreshed = getActiveCrossModalItem();
    if (refreshed?.aiAnalysis) {
      currentCrossItem = refreshed;
      openCrossAIAnalysisModal(refreshed);
    }
  }

  function handleCompareAnalyze() {
    if (compareMode === 'manual') {
      if (compareRight) {
        void handleAnalyze([compareRight.filename]);
      }
      return;
    }
    if (compareMode === 'cross') {
      void runCrossAITriageFromModal();
    }
  }

  function handleCompareOpenAIAnalysis() {
    if (compareMode !== 'cross') return;
    openCrossAIAnalysisModal();
  }

  function handleOpenCrossAIAnalysis(item: CrossResultItem) {
    openCrossAIAnalysisModal(item);
  }

  function syncCrossModalSelection(preferredKey?: string, fallbackIndex = crossQueueIndex) {
    if (!showCompareFullscreen || compareMode !== 'cross') return;
    const state = crossPanel?.getCrossState();
    const filteredItems = state?.crossFilteredItems ?? [];
    if (filteredItems.length === 0) {
      closeCompareFullscreen();
      return;
    }
    let nextIndex = -1;
    if (preferredKey) {
      nextIndex = filteredItems.findIndex((item) => item.itemKey === preferredKey);
    }
    if (nextIndex === -1) {
      nextIndex = Math.min(fallbackIndex, filteredItems.length - 1);
    }
    setCrossCompareIndex(nextIndex);
  }

  // Business logic store (image status, tag filtering, auto-threshold review, etc.)
  const store = new ProjectStore();

  // Core state
  let project = $state<ProjectType | null>(null);
  let loading = $state(true);
  let error = $state<string | null>(null);

  // Config info
  let scenarioCount = $state(0);
  let browserCount = $state(0);
  let viewportCount = $state(0);

  // Cross-compare reports (loaded in loadProject, passed to CrossComparePanel)
  let crossReports = $state<CrossResultsSummary[]>([]);

  // Cache-busting key for images (incremented after rerun)
  let imageCacheKey = $state(0);

  // Tab and view state
  let activeTab = $state<'baselines' | 'tests' | 'diffs' | 'compare' | 'cross'>(initialTab || 'tests');
  let tagFilter = $state<Set<ImageTag>>(new Set(['all']));

  // Pagination and filtering
  let currentPage = $state(0);
  let searchQuery = $state('');
  let debouncedSearchQuery = $state('');

  // Custom compare state
  let comparing = $state(false);
  let compareResult = $state<CompareResult | null>(null);
  let compareLeft = $state<{ type: ImageType; filename: string } | null>(null);
  let compareRight = $state<{ type: ImageType; filename: string } | null>(null);
  let threshold = $state(DEFAULT_COMPARISON_THRESHOLD);

  // AI Analysis state
  let analyzing = $state(false);
  let analysisResults = $state<Array<{ filename: string; analysis?: AIAnalysisResult; error?: string }>>([]);
  let showAnalysisModal = $state(false);
  let aiAnalysisCache = $state<Record<string, AIAnalysisResult>>({});
  type AnalyzeItemInput = {
    baseline: { type: 'baseline' | 'test'; filename: string };
    test: { type: 'baseline' | 'test'; filename: string };
    diff?: { type: 'diff' | 'custom-diff'; filename: string };
    name?: string;
  };

  // Compare fullscreen modal state
  let showCompareFullscreen = $state(false);
  let compareImages = $state<{
    left: { src: string; label: string; updatedAt?: string };
    right: { src: string; label: string; updatedAt?: string };
    diff?: { src: string; label: string; updatedAt?: string };
  } | null>(null);
  let compareFullscreenTitle = $state('');
  let compareMetrics = $state<{
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
    phash?: { similarity: number; baselineHash: string; testHash: string };
  } | null>(null);
  let compareDomDiff = $state<CompareDomDiff | null>(null);
  let currentCrossItem = $state<CrossResultItem | null>(null);
  let crossQueueIndex = $state(0);
  let compareMode = $state<'manual' | 'cross' | null>(null);

  function toCompareDomDiffFromCrossItem(item: CrossResultItem): CompareDomDiff | undefined {
    if (!item.domDiff) return undefined;
    const findings = item.domDiff.findings ?? [];
    return {
      similarity: item.domDiff.similarity,
      summary: item.domDiff.summary,
      findings,
      findingCount: findings.length,
      topFindings: findings.slice(0, 5).map((finding) => ({
        type: finding.type,
        severity: finding.severity,
        description: finding.description,
      })),
    };
  }

  function toCompareDomDiffFromCompareResult(result: CompareResult | null): CompareDomDiff | null {
    if (!result?.domDiff) return null;
    const findings = result.domDiff.findings ?? [];
    return {
      similarity: result.domDiff.similarity,
      summary: result.domDiff.summary,
      findingCount: result.domDiff.findingCount,
      topFindings: result.domDiff.topFindings,
      findings,
    };
  }

  // Multi-select state
  let selectedImages = $state<Set<string>>(new Set());

  // Fullscreen gallery state
  let showGallery = $state(false);
  let galleryStartIndex = $state(0);
  let galleryOrder = $state<string[] | null>(null);

  // Bulk operation state
  let bulkOperating = $state(false);
  let bulkProgress = $state(0);
  let bulkTotal = $state(0);
  let toastMessage = $state<string | null>(null);
  let toastType = $state<'success' | 'error'>('success');

  async function loadProject() {
    try {
      loading = true;
      const [projRes, imagesRes, configRes, resultsRes, crossRes] = await Promise.all([
        projects.get(projectId),
        images.list(projectId),
        config.get(projectId).catch(() => null),
        images.getResults(projectId).catch(() => ({ results: {} })),
        crossCompare.list(projectId).catch(() => ({ results: [] }))
      ]);

      project = projRes.project;
      store.baselines = imagesRes.baselines;
      store.tests = imagesRes.tests;
      store.diffs = imagesRes.diffs;
      store.baselinesMetadata = imagesRes.metadata?.baselines || [];
      store.testsMetadata = imagesRes.metadata?.tests || [];
      store.diffsMetadata = imagesRes.metadata?.diffs || [];
      store.acceptances = imagesRes.acceptances || {};
      store.flags = imagesRes.flags || {};
      store.autoThresholdCaps = imagesRes.autoThresholdCaps || null;
      store.imageResults = resultsRes.results;
      crossReports = crossRes.results;

      // Delegate cross-compare initialization to the panel component
      crossPanel?.initialize(crossRes.results);

      if (configRes?.config) {
        store.configData = configRes.config;
        scenarioCount = configRes.config.scenarios?.length || 0;
        browserCount = configRes.config.browsers?.length || 0;
        viewportCount = configRes.config.viewports?.length || 0;
      } else {
        store.configData = null;
        scenarioCount = 0;
        browserCount = 0;
        viewportCount = 0;
      }

      // Reset pagination when switching data
      currentPage = 0;
    } catch (err) {
      error = getErrorMessage(err, 'Failed to load project');
    } finally {
      loading = false;
    }
  }

  async function runTests() {
    if (!project) return;
    try {
      await startTest(project, () => loadProject());
    } catch (err) {
      error = getErrorMessage(err, 'Failed to run tests');
    }
  }

  async function rerunMissingTests() {
    if (!project) return;
    const filenames = missingTestFilenames;
    if (filenames.length === 0) return;
    try {
      await rerunImage(project, filenames, () => {
        imageCacheKey++;
        loadProject();
      });
      showToast(`Started rerun for ${filenames.length} missing test(s)`, 'success');
    } catch (err) {
      showToast(getErrorMessage(err, 'Failed to rerun missing tests'), 'error');
    }
  }

  async function abortTests() {
    try {
      await abortTest(projectId);
      await loadProject();
    } catch (err) {
      error = getErrorMessage(err, 'Failed to abort tests');
    }
  }

  $effect(() => {
    loadProject();
  });

  $effect(() => {
    projectId;
    crossPanel?.resetPrefs();
  });

  function getStatusColor(status?: ImageStatus) {
    switch (status) {
      case 'passed': return '#22c55e';
      case 'failed': return '#ef4444';
      case 'new': return '#f59e0b';
      default: return '#666';
    }
  }

  // Delegate tag/status logic to store, binding current activeTab
  function getTagFor(filename: string): ImageTag {
    return store.getTagFor(filename, activeTab);
  }

  function matchesTagSet(filename: string, tags: Set<ImageTag>): boolean {
    return store.matchesTagSet(filename, tags, activeTab);
  }

  function setTagFilter(tag: ImageTag) {
    tagFilter = new Set([tag]);
  }

  function toggleTagFilter(tag: ImageTag, event?: MouseEvent) {
    const multi = !!event?.metaKey || !!event?.ctrlKey;
    if (!multi) {
      setTagFilter(tag);
      return;
    }
    if (tag === 'all') {
      setTagFilter('all');
      return;
    }
    const next = new Set(tagFilter);
    if (next.has('all')) next.delete('all');
    if (next.has(tag)) {
      next.delete(tag);
    } else {
      next.add(tag);
    }
    if (next.size === 0) next.add('all');
    tagFilter = next;
  }

  function isTagActive(tag: ImageTag): boolean {
    if (tagFilter.has('all')) return tag === 'all';
    return tagFilter.has(tag);
  }

  // Derived values from store
  let totalCount = $derived(store.totalCount);
  let totalTab = $derived(store.totalTab);
  let failedCount = $derived(store.failedCount);
  let newCount = $derived(store.newCount);
  let passedCount = $derived(store.passedCount);
  let missingTestCount = $derived(store.missingTestCount);
  let missingTestFilenames = $derived(store.missingTests);
  let autoThresholdReviewCount = $derived(store.autoThresholdReviewCount);
  let testState = $derived(runningTests.get(projectId));
  let testError = $derived(testErrors.get(projectId));
  let persistedTestWarning = $derived(testWarnings.get(projectId) ?? null);
  let hasLiveTestWarnings = $derived((testState?.warnings?.length ?? 0) > 0);
  let activeTestWarnings = $derived(
    hasLiveTestWarnings
      ? (testState?.warnings ?? [])
      : (persistedTestWarning?.warnings ?? [])
  );
  let hasTestDiagnostics = $derived(activeTestWarnings.length > 0);
  let testCaptureDiagnostics = $derived(
    testState?.captureDiagnostics ?? persistedTestWarning?.captureDiagnostics ?? null
  );

  // Image lists based on active tab, filtered by tag if set
  let rawList = $derived(store.rawList(activeTab, tagFilter));

  // Filter list by search query
  let fullList = $derived.by(() => {
    if (!debouncedSearchQuery.trim()) return rawList;
    const q = debouncedSearchQuery.toLowerCase();
    return rawList.filter(filename => filename.toLowerCase().includes(q));
  });

  let totalPages = $derived(Math.ceil(fullList.length / PAGE_SIZE));
  let currentList = $derived(fullList.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE));

  let crossCompareQueue = $derived.by(() => {
    if (!showCompareFullscreen || compareMode !== 'cross') return [];
    const state = crossPanel?.getCrossState();
    const results = state?.crossResults;
    const filteredItems = state?.crossFilteredItems ?? [];
    if (!results) return [];
    const baselineLabel = results.baselineLabel || 'Baseline';
    const testLabel = results.testLabel || 'Test';
    return filteredItems.map((item) => ({
      images: {
        left: { src: getFileUrl(item.baseline), label: baselineLabel, updatedAt: item.baselineUpdatedAt },
        right: { src: getFileUrl(item.test), label: testLabel, updatedAt: item.testUpdatedAt },
        diff: item.diff ? { src: getFileUrl(item.diff), label: 'Diff', updatedAt: item.diffUpdatedAt } : undefined,
      },
      title: `${item.scenario} · ${item.viewport}`,
      metrics: {
        pixelDiff: item.pixelDiff,
        diffPercentage: item.diffPercentage,
        ssimScore: item.ssimScore,
        engineResults: item.engineResults,
        phash: item.phash,
      },
      domDiff: toCompareDomDiffFromCrossItem(item),
      domSnapshotStatus: item.domSnapshot,
      viewport: item.viewport,
      badge: {
        label: item.flagged
          ? 'Flagged'
          : item.accepted
            ? 'Approved'
            : item.match
              ? item.diffPercentage > 0
                ? 'Smart Pass'
                : 'Match'
              : item.reason === 'diff'
                ? 'Diff'
                : 'Issue',
        tone: item.flagged
          ? 'flagged'
          : item.accepted
            ? 'approved'
            : item.match
              ? item.diffPercentage > 0
                ? 'smart'
                : 'passed'
              : item.reason === 'diff'
                ? 'diff'
                : 'unapproved',
      },
      accepted: item.accepted,
      flagged: item.flagged,
      aiRecommendation: item.aiAnalysis?.recommendation,
      aiCategory: item.aiAnalysis?.category,
      aiConfidence: item.aiAnalysis?.confidence,
    }));
  });


  // Selected count for bulk action bar
  let selectedCount = $derived(selectedImages.size);

  // Delegate image status to store
  function getImageStatus(filename: string): ImageStatus | null {
    return store.getImageStatus(filename);
  }

  async function setImageFlag(filename: string) {
    const previous = store.flags[filename];
    store.flags = {
      ...store.flags,
      [filename]: {
        filename,
        flaggedAt: new Date().toISOString(),
      },
    };
    try {
      const result = await images.flag(projectId, filename);
      store.flags = {
        ...store.flags,
        [filename]: result.flag,
      };
    } catch (err) {
      if (previous) {
        store.flags = { ...store.flags, [filename]: previous };
      } else {
        const { [filename]: _removed, ...rest } = store.flags;
        store.flags = rest;
      }
      showToast(getErrorMessage(err, 'Failed to flag image'), 'error');
    }
  }

  async function unsetImageFlag(filename: string) {
    const previous = store.flags[filename];
    if (!previous) return;
    const { [filename]: _removed, ...rest } = store.flags;
    store.flags = rest;
    try {
      await images.unflag(projectId, filename);
    } catch (err) {
      store.flags = { ...store.flags, [filename]: previous };
      showToast(getErrorMessage(err, 'Failed to unflag image'), 'error');
    }
  }

  async function handleCompareFlag() {
    if (compareMode === 'manual' && compareRight) {
      await setImageFlag(compareRight.filename);
      return;
    }
    if (compareMode === 'cross') {
      await flagCrossFromModal();
    }
  }

  async function handleCompareUnflag() {
    if (compareMode === 'manual' && compareRight) {
      await unsetImageFlag(compareRight.filename);
      return;
    }
    if (compareMode === 'cross') {
      await unflagCrossFromModal();
    }
  }

  // Check if selected images are approvable (must have test images)
  let selectedApprovable = $derived.by(() => {
    return [...selectedImages].filter(f => store.testsSet.has(f));
  });

  // Check if selected images are rejectable (must be tests, not passed)
  let selectedRejectable = $derived.by(() => {
    return [...selectedImages].filter(f => {
      const status = store.getImageStatus(f);
      return status === 'failed' || status === 'new';
    });
  });

  /** Maps current tab to image type for API calls */
  let currentImageType = $derived<'baseline' | 'test' | 'diff'>(
    activeTab === 'baselines' ? 'baseline' : activeTab === 'tests' ? 'test' : 'diff'
  );

  let metadataMap = $derived.by(() => {
    const active = store.activeMetadata(activeTab);
    return new Map(active.map(meta => [meta.filename, meta]));
  });

  function getMetadataForCompareItem(
    item: { type: ImageType; filename: string } | null
  ): ImageMetadata | null {
    if (!item) return null;
    return store.getMetadataForType(item.type as ImageType, item.filename);
  }

  function getViewportForCompareItem(item: { type: ImageType; filename: string } | null): string | null {
    const meta = getMetadataForCompareItem(item);
    return meta?.viewport ?? null;
  }

  let compareViewport = $derived.by(() => {
    const rightViewport = getViewportForCompareItem(compareRight);
    if (rightViewport) return rightViewport;
    return getViewportForCompareItem(compareLeft);
  });

  // Gallery queue from store, filtered by current tab/tag
  let filteredGalleryQueue = $derived(store.filteredGalleryQueue(activeTab, tagFilter));
  let orderedGalleryQueue = $derived.by(() => {
    if (!galleryOrder || galleryOrder.length === 0) return filteredGalleryQueue;
    const byFilename = new Map(filteredGalleryQueue.map((item) => [item.filename, item]));
    const ordered: GalleryImage[] = [];
    for (const filename of galleryOrder) {
      const item = byFilename.get(filename);
      if (item) ordered.push(item);
    }
    return ordered.length > 0 ? ordered : filteredGalleryQueue;
  });

  function deselectAll() {
    selectedImages = new Set();
  }

  function showToast(message: string, type: 'success' | 'error') {
    toastMessage = message;
    toastType = type;
    const timeout = type === 'error' ? 5000 : 3000;
    setTimeout(() => {
      toastMessage = null;
    }, timeout);
  }

  function notifySidebarRefresh() {
    window.dispatchEvent(new CustomEvent('vrt:sidebar-refresh'));
  }

  async function handleBulkApprove() {
    const filenames = selectedApprovable;
    if (filenames.length === 0) return;

    bulkOperating = true;
    bulkProgress = 0;
    bulkTotal = filenames.length;

    const originalBaselines = [...store.baselines];
    const originalTests = [...store.tests];
    const originalDiffs = [...store.diffs];
    const approvedSet = new Set<string>();
    const failedSet = new Set<string>();

    try {
      for (const filename of filenames) {
        try {
          await images.approve(projectId, filename);
          approvedSet.add(filename);
          store.baselines = [...new Set([...store.baselines, filename])];
          store.diffs = store.diffs.filter((d) => d !== filename);
        } catch {
          failedSet.add(filename);
        } finally {
          bulkProgress = approvedSet.size + failedSet.size;
        }
      }

      if (failedSet.size > 0) {
        await loadProject();
        showToast(`Approved ${approvedSet.size}, failed ${failedSet.size}`, 'error');
      } else {
        showToast(`Approved ${approvedSet.size} images`, 'success');
      }

      deselectAll();
      notifySidebarRefresh();
    } catch (err) {
      store.baselines = originalBaselines;
      store.tests = originalTests;
      store.diffs = originalDiffs;
      showToast(getErrorMessage(err, 'Bulk approve failed'), 'error');
    } finally {
      bulkOperating = false;
    }
  }

  async function handleBulkReject() {
    const filenames = selectedRejectable;
    if (filenames.length === 0) return;

    bulkOperating = true;
    bulkProgress = 0;
    bulkTotal = filenames.length;

    const originalTests = [...store.tests];
    const originalDiffs = [...store.diffs];

    const filenameSet = new Set(filenames);
    store.tests = store.tests.filter(t => !filenameSet.has(t));
    store.diffs = store.diffs.filter(d => !filenameSet.has(d));

    try {
      const rejected: string[] = [];
      const failed: string[] = [];

      for (const filename of filenames) {
        try {
          await images.reject(projectId, filename);
          rejected.push(filename);
          bulkProgress = rejected.length + failed.length;
        } catch (err) {
          log.error(`Failed to reject ${filename}:`, getErrorMessage(err));
          failed.push(filename);
        }
      }

      if (failed.length > 0) {
        await loadProject();
        showToast(`Rejected ${rejected.length}, failed ${failed.length}`, 'error');
      } else {
        showToast(`Rejected ${rejected.length} images`, 'success');
      }

      deselectAll();
      notifySidebarRefresh();
    } catch (err) {
      store.tests = originalTests;
      store.diffs = originalDiffs;
      showToast(getErrorMessage(err, 'Bulk reject failed'), 'error');
    } finally {
      bulkOperating = false;
    }
  }

  async function handleBulkDelete() {
    if (!project || selectedImages.size === 0) return;
    const filenames = [...selectedImages];
    const scopeLabel = activeTab === 'baselines' ? 'baselines' : activeTab === 'diffs' ? 'diffs/tests' : 'tests';

    if (!confirm(`Delete ${filenames.length} ${scopeLabel} image(s)? This cannot be undone.`)) {
      return;
    }

    bulkOperating = true;
    bulkProgress = 0;
    bulkTotal = filenames.length;

    const originalBaselines = [...store.baselines];
    const originalTests = [...store.tests];
    const originalDiffs = [...store.diffs];

    const filenameSet = new Set(filenames);
    if (activeTab === 'baselines') {
      store.baselines = store.baselines.filter((b) => !filenameSet.has(b));
    } else {
      store.tests = store.tests.filter((t) => !filenameSet.has(t));
      store.diffs = store.diffs.filter((d) => !filenameSet.has(d));
    }

    try {
      const deleted: string[] = [];
      const failed: string[] = [];

      for (const filename of filenames) {
        try {
          if (activeTab === 'baselines') {
            await images.revert(projectId, filename);
          } else {
            await images.reject(projectId, filename);
          }
          deleted.push(filename);
          bulkProgress = deleted.length + failed.length;
        } catch (err) {
          log.error(`Failed to delete ${filename}:`, getErrorMessage(err));
          failed.push(filename);
        }
      }

      if (failed.length > 0) {
        await loadProject();
        showToast(`Deleted ${deleted.length}, failed ${failed.length}`, 'error');
      } else {
        showToast(`Deleted ${deleted.length} images`, 'success');
      }

      deselectAll();
      notifySidebarRefresh();
    } catch (err) {
      store.baselines = originalBaselines;
      store.tests = originalTests;
      store.diffs = originalDiffs;
      showToast(getErrorMessage(err, 'Bulk delete failed'), 'error');
    } finally {
      bulkOperating = false;
    }
  }

  // Derived function: new reference when imageCacheKey changes, so child components re-derive
  let getImageUrl = $derived.by(() => {
    const key = imageCacheKey;
    return (type: 'baseline' | 'test' | 'diff', filename: string) => {
      const url = images.getUrl(projectId, type, filename);
      return key ? `${url}?v=${key}` : url;
    };
  });

  let getFileUrl = $derived.by(() => {
    const key = imageCacheKey;
    return (relativePath: string) => {
      const url = images.getFileUrl(projectId, relativePath);
      return key ? `${url}&v=${key}` : url;
    };
  });

  let getFileThumbUrl = $derived.by(() => {
    const key = imageCacheKey;
    return (relativePath: string) => {
      const url = images.getFileUrl(projectId, relativePath);
      const thumbUrl = `${url}&thumb=1&max=${CROSS_THUMB_MAX}`;
      return key ? `${thumbUrl}&v=${key}` : thumbUrl;
    };
  });

  // Gallery functions
  function openGallery(filename: string, orderedFilenames?: string[]) {
    const nextOrder = orderedFilenames && orderedFilenames.length > 0 ? [...orderedFilenames] : null;
    galleryOrder = nextOrder;
    const queue =
      nextOrder && nextOrder.length > 0
        ? (() => {
            const byFilename = new Map(filteredGalleryQueue.map((item) => [item.filename, item]));
            const ordered: GalleryImage[] = [];
            for (const name of nextOrder) {
              const item = byFilename.get(name);
              if (item) ordered.push(item);
            }
            return ordered.length > 0 ? ordered : filteredGalleryQueue;
          })()
        : filteredGalleryQueue;
    const index = queue.findIndex((item) => item.filename === filename);
    galleryStartIndex = index >= 0 ? index : 0;
    showGallery = true;
  }

  function closeGallery() {
    showGallery = false;
    galleryOrder = null;
  }

  function handleGalleryApprove(filename: string) {
    const originalBaselines = [...store.baselines];
    const originalDiffs = [...store.diffs];

    store.baselines = [...new Set([...store.baselines, filename])];
    store.diffs = store.diffs.filter((d) => d !== filename);

    images
      .approve(projectId, filename)
      .then(() => {
        notifySidebarRefresh();
      })
      .catch((err) => {
        store.baselines = originalBaselines;
        store.diffs = originalDiffs;
        showToast(getErrorMessage(err, 'Approve failed'), 'error');
      });
  }

  function handleGalleryReject(filename: string) {
    const originalTests = [...store.tests];
    const originalDiffs = [...store.diffs];

    store.tests = store.tests.filter((t) => t !== filename);
    store.diffs = store.diffs.filter((d) => d !== filename);

    images
      .reject(projectId, filename)
      .then(() => {
        notifySidebarRefresh();
      })
      .catch((err) => {
        store.tests = originalTests;
        store.diffs = originalDiffs;
        showToast(getErrorMessage(err, 'Reject failed'), 'error');
      });
  }

  async function handleGalleryFlag(filename: string) {
    await setImageFlag(filename);
  }

  async function handleGalleryUnflag(filename: string) {
    await unsetImageFlag(filename);
  }

  async function handleRerun(filename: string) {
    if (!project) return;
    try {
      await rerunImage(project, filename, () => { imageCacheKey++; loadProject(); });
    } catch (err) {
      showToast(getErrorMessage(err, 'Rerun failed'), 'error');
    }
  }

  async function handleBulkRerun() {
    if (!project || selectedImages.size === 0) return;
    const filenames = [...selectedImages];
    deselectAll();
    try {
      await rerunImage(project, filenames, () => { imageCacheKey++; loadProject(); });
    } catch (err) {
      showToast(getErrorMessage(err, 'Rerun failed'), 'error');
    }
  }

  // Compare functions
  async function handleCustomCompare(left: { type: ImageType; filename: string }, right: { type: ImageType; filename: string }) {
    try {
      comparing = true;
      compareLeft = left;
      compareRight = right;
      compareResult = await compare.custom(projectId, left, right, threshold);
    } catch (err) {
      error = getErrorMessage(err, 'Comparison failed');
    } finally {
      comparing = false;
    }
  }

  async function recompareWithThreshold() {
    if (!compareLeft || !compareRight) return;
    await handleCustomCompare(compareLeft, compareRight);
  }

  async function handleAcceptForBrowser(filename: string) {
    if (!compareResult || !compareLeft || !compareRight) {
      error = 'No comparison result available for acceptance';
      return;
    }

    try {
      const leftMeta = getMetadataForCompareItem(compareLeft);
      const rightMeta = getMetadataForCompareItem(compareRight);
      const baselineMeta =
        compareLeft.type === 'baseline'
          ? leftMeta
          : compareRight.type === 'baseline'
            ? rightMeta
            : null;
      const testMeta =
        compareLeft.type === 'test'
          ? leftMeta
          : compareRight.type === 'test'
            ? rightMeta
            : null;
      const scenario =
        testMeta?.scenario ?? baselineMeta?.scenario ?? leftMeta?.scenario ?? rightMeta?.scenario;
      const viewport =
        testMeta?.viewport ?? baselineMeta?.viewport ?? leftMeta?.viewport ?? rightMeta?.viewport;
      const viewportInfo = viewport ? store.viewportMap.get(viewport) : undefined;

      await acceptance.create(projectId, {
        filename,
        comparedAgainst: {
          filename: compareLeft.filename,
          type: compareLeft.type,
        },
        metrics: {
          pixelDiff: compareResult.pixelDiff,
          diffPercentage: compareResult.diffPercentage,
          ssimScore: compareResult.ssimScore,
          phash: compareResult.phash?.similarity,
        },
        signals: {
          scenario: scenario ?? undefined,
          viewport: viewport ?? undefined,
          viewportWidth: viewportInfo?.width,
          viewportHeight: viewportInfo?.height,
          browserPair: {
            baseline: baselineMeta
              ? { name: baselineMeta.browser, version: baselineMeta.version }
              : undefined,
            test: testMeta ? { name: testMeta.browser, version: testMeta.version } : undefined,
          },
        },
      });
      await loadProject();
    } catch (err) {
      error = getErrorMessage(err, 'Failed to accept');
    }
  }

  async function handleRevokeAcceptance(filename: string) {
    try {
      await acceptance.revoke(projectId, filename);
      await loadProject();
    } catch (err) {
      error = getErrorMessage(err, 'Failed to revoke acceptance');
    }
  }

  async function runAnalyzeItems(items: AnalyzeItemInput[]): Promise<void> {
    if (items.length === 0) return;
    try {
      analyzing = true;
      const result = await analyze.run(projectId, items);
      analysisResults = result.results;

      for (const r of result.results) {
        if (r.analysis) {
          aiAnalysisCache[r.filename] = r.analysis;
        }
      }
      aiAnalysisCache = { ...aiAnalysisCache };
      showAnalysisModal = true;
    } catch (err) {
      error = getErrorMessage(err, 'AI analysis failed');
    } finally {
      analyzing = false;
    }
  }

  async function handleAnalyze(filenames: string[]) {
    if (!compareLeft || !compareRight) {
      error = 'Select images to compare before analyzing';
      return;
    }

    const items: AnalyzeItemInput[] = filenames.map((filename) => ({
      baseline: { type: compareLeft.type, filename: compareLeft.filename },
      test: { type: compareRight.type, filename },
      diff: compareResult?.diffFilename
        ? { type: 'custom-diff', filename: compareResult.diffFilename }
        : undefined,
      name: filename,
    }));

    await runAnalyzeItems(items);
  }

  function buildTriageItems(
    filenames: string[]
  ): { items: AnalyzeItemInput[]; skippedNoBaseline: number; skippedNoTest: number } {
    const unique = [...new Set(filenames)];
    const items: AnalyzeItemInput[] = [];
    let skippedNoBaseline = 0;
    let skippedNoTest = 0;

    for (const filename of unique) {
      if (!store.testsSet.has(filename)) {
        skippedNoTest += 1;
        continue;
      }
      if (!store.baselinesSet.has(filename)) {
        skippedNoBaseline += 1;
        continue;
      }

      const meta = store.testMetadataMap.get(filename) ?? store.baselineMetadataMap.get(filename);
      items.push({
        baseline: { type: 'baseline', filename },
        test: { type: 'test', filename },
        diff: store.diffsSet.has(filename) ? { type: 'diff', filename } : undefined,
        name: meta?.scenario ?? filename,
      });
    }

    return { items, skippedNoBaseline, skippedNoTest };
  }

  async function handleAITriage(filenames: string[]) {
    const { items, skippedNoBaseline, skippedNoTest } = buildTriageItems(filenames);
    if (items.length === 0) {
      showToast('No comparable baseline/test pairs selected for AI triage', 'error');
      return;
    }

    await runAnalyzeItems(items);

    if (skippedNoBaseline > 0 || skippedNoTest > 0) {
      const skippedParts: string[] = [];
      if (skippedNoBaseline > 0) skippedParts.push(`${skippedNoBaseline} missing baseline`);
      if (skippedNoTest > 0) skippedParts.push(`${skippedNoTest} missing test`);
      showToast(`AI triage skipped ${skippedParts.join(', ')}`, 'error');
    }
  }

  function closeAnalysisModal() {
    showAnalysisModal = false;
    analysisResults = [];
  }

  function handleAnalysisAccept(filename: string) {
    if (compareMode === 'cross') {
      void approveCrossFromModal();
      return;
    }
    void handleAcceptForBrowser(filename);
  }

  function openFullscreenCompare() {
    if (!compareLeft || !compareRight || !compareResult) return;

    compareImages = {
      left: {
        src: getImageUrl(compareLeft.type, compareLeft.filename),
        label: 'Left',
      },
      right: {
        src: getImageUrl(compareRight.type, compareRight.filename),
        label: 'Right',
      },
      diff: {
        src: compareResult.diffUrl,
        label: 'Diff',
      },
    };
    compareMetrics = {
      pixelDiff: compareResult.pixelDiff,
      diffPercentage: compareResult.diffPercentage,
      ssimScore: compareResult.ssimScore,
      engineResults: compareResult.engineResults,
      phash: compareResult.phash,
    };
    compareDomDiff = toCompareDomDiffFromCompareResult(compareResult);
    compareMode = 'manual';
    compareFullscreenTitle = `${compareLeft.filename} vs ${compareRight.filename}`;
    showCompareFullscreen = true;
  }

  function buildCrossComparePayload(item: CrossResultItem, results: CrossResults) {
    const baselineLabel = results.baselineLabel || 'Baseline';
    const testLabel = results.testLabel || 'Test';
    return {
      images: {
        left: { src: getFileUrl(item.baseline), label: baselineLabel, updatedAt: item.baselineUpdatedAt },
        right: { src: getFileUrl(item.test), label: testLabel, updatedAt: item.testUpdatedAt },
        diff: item.diff ? { src: getFileUrl(item.diff), label: 'Diff', updatedAt: item.diffUpdatedAt } : undefined,
      },
      metrics: {
        pixelDiff: item.pixelDiff,
        diffPercentage: item.diffPercentage,
        ssimScore: item.ssimScore,
        engineResults: item.engineResults,
        phash: item.phash,
      },
      domDiff: toCompareDomDiffFromCrossItem(item),
      domSnapshotStatus: item.domSnapshot,
      title: `${item.scenario} · ${item.viewport}`,
    };
  }

  function setCrossCompareItem(item: CrossResultItem, results: CrossResults) {
    const payload = buildCrossComparePayload(item, results);
    compareImages = payload.images;
    compareMetrics = payload.metrics;
    compareDomDiff = payload.domDiff ?? null;
    compareFullscreenTitle = payload.title;
    currentCrossItem = item;
  }

  function setCrossCompareIndex(index: number) {
    const state = crossPanel?.getCrossState();
    const filteredItems = state?.crossFilteredItems ?? [];
    const results = state?.crossResults;
    if (filteredItems.length === 0 || !results) return;
    const bounded = Math.max(0, Math.min(filteredItems.length - 1, index));
    crossQueueIndex = bounded;
    const item = filteredItems[bounded];
    if (item) {
      setCrossCompareItem(item, results);
    }
  }

  function handleOpenCrossCompare(item: CrossResultItem, index: number, filteredItems: CrossResultItem[], results: CrossResults) {
    setCrossCompareItem(item, results);
    crossQueueIndex = index;
    compareMode = 'cross';
    showCompareFullscreen = true;
  }

  function closeCompareFullscreen() {
    showCompareFullscreen = false;
    compareImages = null;
    compareMetrics = null;
    compareDomDiff = null;
    compareMode = null;
    currentCrossItem = null;
    crossQueueIndex = 0;
  }

  // Reset page, search, and selection when switching tabs or filter
  $effect(() => {
    activeTab;
    tagFilter;
    currentPage = 0;
    searchQuery = '';
    selectedImages = new Set();
  });

  // Reset page when search changes
  $effect(() => {
    debouncedSearchQuery;
    currentPage = 0;
  });

  // Debounce search input to keep filtering responsive on large lists
  $effect(() => {
    const query = searchQuery;
    if (!query.trim()) {
      debouncedSearchQuery = '';
      return;
    }
    const handle = setTimeout(() => {
      debouncedSearchQuery = query;
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  });
</script>

<div class="project-page">
  <ProjectHeader
    title={project?.name || projectId}
    path={project?.path}
    testState={testState}
    onRunTests={runTests}
    onAbortTests={abortTests}
    onOpenConfig={() => navigate(`/config/${projectId}`)}
  />

  {#if error}
    <div class="error">{error}</div>
  {/if}

  {#if testError}
    <div class="error test-error">
      <div class="error-header">
        <strong>Test failed</strong>
        <button class="error-close" onclick={() => clearTestError(projectId)}>&times;</button>
      </div>
      <div class="error-message">{testError}</div>
    </div>
  {/if}

  {#if hasTestDiagnostics && activeTab !== 'tests'}
    <div class="warning test-warning">
      <div class="warning-header">
        <strong>Pipeline diagnostics</strong>
        {#if persistedTestWarning && !hasLiveTestWarnings}
          <button class="warning-close" onclick={() => clearTestWarning(projectId)}>&times;</button>
        {/if}
      </div>
      <ul class="warning-list">
        {#each activeTestWarnings as warning}
          <li>{warning}</li>
        {/each}
      </ul>
      {#if testCaptureDiagnostics}
        <div class="warning-meta">
          Screenshots: {testCaptureDiagnostics.capturedScreenshots}/{testCaptureDiagnostics.expectedScreenshots}
          · Snapshots: {testCaptureDiagnostics.capturedSnapshots}/{testCaptureDiagnostics.expectedSnapshots}
        </div>
        {#if testCaptureDiagnostics.missingSnapshotSamples.length > 0}
          <div class="warning-samples">
            Missing snapshot samples:
            {testCaptureDiagnostics.missingSnapshotSamples.join(', ')}
          </div>
        {/if}
      {/if}
    </div>
  {/if}

  {#if loading}
    <div class="loading">Loading project...</div>
  {:else if project}

    <!-- Last Run & Config Summary -->
    <div class="project-meta">
      <div class="meta-row">
        <div class="config-summary">
          <span class="config-item">
            <span class="config-value">{scenarioCount}</span>
            <span class="config-label">Scenarios</span>
          </span>
          <span class="config-item">
            <span class="config-value">{browserCount}</span>
            <span class="config-label">Browsers</span>
          </span>
          <span class="config-item">
            <span class="config-value">{viewportCount}</span>
            <span class="config-label">Viewports</span>
          </span>
        </div>

        <div class="status-grid">
          <button
            class="status-card total clickable"
            class:active={activeTab === totalTab && tagFilter.has('all')}
            onclick={() => { activeTab = totalTab; setTagFilter('all'); }}
            title="All images in the current tab"
          >
            <div class="status-value">{totalCount}</div>
            <div class="status-label">Total</div>
          </button>
          <button
            class="status-card passed clickable"
            class:active={isTagActive('passed')}
            onclick={() => { activeTab = 'tests'; setTagFilter('passed'); }}
            title="Baseline matches test (no diff)"
          >
            <div class="status-value">{passedCount}</div>
            <div class="status-label">Passed</div>
          </button>
          <button
            class="status-card failed clickable"
            class:highlight={failedCount > 0}
            class:active={activeTab === 'diffs'}
            onclick={() => { activeTab = 'diffs'; setTagFilter('diff'); }}
            title="Diffs detected between baseline and test"
          >
            <div class="status-value">{failedCount}</div>
            <div class="status-label">Failed</div>
          </button>
          <button
            class="status-card new clickable"
            class:active={isTagActive('new')}
            onclick={() => { activeTab = 'tests'; setTagFilter('new'); }}
            title="Test exists but no baseline"
          >
            <div class="status-value">{newCount}</div>
            <div class="status-label">New</div>
          </button>
        </div>
      </div>

      {#if missingTestCount > 0}
        <div class="meta-row missing-tests-row">
          <div class="missing-tests-message">
            <strong>{missingTestCount}</strong> baseline image(s) are missing test screenshots.
          </div>
          <div class="missing-tests-actions">
            <button
              class="btn small"
              onclick={() => {
                activeTab = 'baselines';
                setTagFilter('all');
              }}
            >
              Review Baselines
            </button>
            <button
              class="btn small warning"
              onclick={rerunMissingTests}
              disabled={!!testState}
              title="Generate test screenshots for missing baseline pairs"
            >
              {testState ? 'Running Tests...' : `Run Missing Tests (${missingTestCount})`}
            </button>
          </div>
        </div>
      {/if}

      {#if project.lastRun}
        <div class="meta-row meta-row-secondary">
          <div class="last-run">
            <span class="last-run-label">Last run:</span>
            <span class="last-run-time">{new Date(project.lastRun).toLocaleString()}</span>
            {#if project.lastStatus}
              <span class="last-status-badge" style="background: {getStatusColor(project.lastStatus)}">
                {project.lastStatus}
              </span>
            {/if}
          </div>
          {#if project.lastTiming}
            <div class="timing-stats">
              <span class="timing" title="Screenshot capture time">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                  <circle cx="9" cy="9" r="2"></circle>
                  <path d="M21 15l-3.086-3.086a2 2 0 0 0-2.828 0L6 21"></path>
                </svg>
                {formatDuration(project.lastTiming.screenshotDuration)}
              </span>
              <span class="timing" title="Comparison time">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5"></path>
                </svg>
                {formatDuration(project.lastTiming.compareDuration)}
              </span>
              <span class="timing total" title="Total time">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <circle cx="12" cy="12" r="10"></circle>
                  <polyline points="12 6 12 12 16 14"></polyline>
                </svg>
                {formatDuration(project.lastTiming.totalDuration)}
              </span>
            </div>
          {/if}
        </div>
      {/if}
    </div>

    <!-- Tab Bar -->
    <div class="tabs">
      <button
        class="tab"
        class:active={activeTab === 'baselines'}
        onclick={() => { activeTab = 'baselines'; setTagFilter('all'); }}
      >
        Baselines ({store.baselines.length})
      </button>
      <button
        class="tab"
        class:active={activeTab === 'tests' && tagFilter.has('all')}
        onclick={() => { activeTab = 'tests'; setTagFilter('all'); }}
      >
        Tests ({store.tests.length})
      </button>
      <button
        class="tab"
        class:active={activeTab === 'diffs'}
        onclick={() => { activeTab = 'diffs'; setTagFilter('diff'); }}
      >
        Diffs ({store.diffs.length})
      </button>
      <button
        class="tab"
        class:active={activeTab === 'cross'}
        onclick={() => { activeTab = 'cross'; setTagFilter('all'); }}
      >
        Cross Compare
      </button>
    </div>

    <!-- Content Area -->
    <div class="content">
      {#if activeTab === 'compare'}
        <div class="compare-content">
          <CompareSelector
            baselines={store.baselinesMetadata}
            tests={store.testsMetadata}
            diffs={store.diffsMetadata}
            onCompare={handleCustomCompare}
            {comparing}
          />

          {#if compareResult && compareLeft && compareRight}
            <CompareResults
              {compareResult}
              {compareLeft}
              {compareRight}
              {comparing}
              bind:threshold
              {getImageUrl}
              onRecompare={recompareWithThreshold}
              onOpenFullscreen={openFullscreenCompare}
            />
          {:else if !comparing}
            <div class="compare-hint">
              Select two images above to compare them
            </div>
          {/if}
        </div>
      {:else if activeTab === 'cross'}
        <CrossComparePanel
          bind:this={crossPanel}
          {projectId}
          bind:crossReports
          {getFileUrl}
          {getFileThumbUrl}
          onOpenCrossCompare={handleOpenCrossCompare}
          onOpenAIAnalysis={handleOpenCrossAIAnalysis}
          onSetActiveTab={(tab) => activeTab = tab}
        />
      {:else}
        {#if activeTab === 'tests' && hasTestDiagnostics}
          <div class="warning test-warning test-warning-inline">
            <div class="warning-header">
              <strong>Pipeline diagnostics</strong>
              {#if persistedTestWarning && !hasLiveTestWarnings}
                <button class="warning-close" onclick={() => clearTestWarning(projectId)}>&times;</button>
              {/if}
            </div>
            <ul class="warning-list">
              {#each activeTestWarnings as warning}
                <li>{warning}</li>
              {/each}
            </ul>
            {#if testCaptureDiagnostics}
              <div class="warning-meta">
                Screenshots: {testCaptureDiagnostics.capturedScreenshots}/{testCaptureDiagnostics.expectedScreenshots}
                · Snapshots: {testCaptureDiagnostics.capturedSnapshots}/{testCaptureDiagnostics.expectedSnapshots}
              </div>
              {#if testCaptureDiagnostics.missingSnapshotSamples.length > 0}
                <div class="warning-samples">
                  Missing snapshot samples:
                  {testCaptureDiagnostics.missingSnapshotSamples.join(', ')}
                </div>
              {/if}
            {/if}
          </div>
        {/if}
        <ImageGrid
          {currentList}
          {fullList}
          {rawList}
          {totalPages}
          bind:currentPage
          bind:searchQuery
          bind:tagFilter
          bind:selectedImages
          {currentImageType}
          {autoThresholdReviewCount}
          {activeTab}
          {testState}
          {getImageUrl}
          {getImageStatus}
          {getTagFor}
          {isTagActive}
          {toggleTagFilter}
          {matchesTagSet}
          {metadataMap}
          imageResults={store.imageResults}
          onOpenGallery={openGallery}
        />
      {/if}

    </div>

    <!-- Remove Project -->
    <div class="danger-zone">
      <button class="btn-text-danger" onclick={deleteProject}>
        Remove project from list
      </button>
    </div>
  {/if}
</div>

<!-- AI Analysis Modal -->
{#if showAnalysisModal && analysisResults.length > 0}
  <AIAnalysisModal
    results={analysisResults}
    onClose={closeAnalysisModal}
    onAccept={handleAnalysisAccept}
  />
{/if}

<!-- Fullscreen Compare Modal -->
{#if showCompareFullscreen && compareImages && compareMetrics}
  <FullscreenGallery
    compareImages={compareImages}
    compareTitle={compareFullscreenTitle}
    compareMetrics={compareMetrics}
    compareDomDiff={compareDomDiff ?? undefined}
    compareViewport={compareViewport ?? undefined}
    compareQueue={compareMode === 'cross' ? crossCompareQueue : []}
    compareIndex={compareMode === 'cross' ? crossQueueIndex : 0}
    onCompareNavigate={compareMode === 'cross' ? setCrossCompareIndex : undefined}
    compareThreshold={compareMode === 'manual' ? threshold : undefined}
    onThresholdChange={compareMode === 'manual' ? (t) => (threshold = t) : undefined}
    onRecompare={compareMode === 'manual' ? recompareWithThreshold : undefined}
    onAnalyze={compareMode ? handleCompareAnalyze : undefined}
    onOpenAIAnalysis={compareMode === 'cross' ? handleCompareOpenAIAnalysis : undefined}
    onFlag={
      compareMode === 'manual'
        ? () => compareRight && setImageFlag(compareRight.filename)
        : compareMode === 'cross'
          ? handleCompareFlag
          : undefined
    }
    onUnflag={
      compareMode === 'manual'
        ? () => compareRight && unsetImageFlag(compareRight.filename)
        : compareMode === 'cross'
          ? handleCompareUnflag
          : undefined
    }
    onAcceptForBrowser={
      compareMode === 'manual'
        ? () => compareRight && handleAcceptForBrowser(compareRight.filename)
        : compareMode === 'cross'
          ? approveCrossFromModal
          : undefined
    }
    onRevokeAcceptance={
      compareMode === 'manual'
        ? () => compareRight && handleRevokeAcceptance(compareRight.filename)
        : compareMode === 'cross'
          ? revokeCrossFromModal
          : undefined
    }
    isAccepted={
      compareMode === 'manual' && compareRight
        ? !!store.acceptances[compareRight.filename]
        : compareMode === 'cross'
          ? !!currentCrossItem?.accepted
          : false
    }
    isFlagged={
      compareMode === 'manual' && compareRight
        ? !!store.flags[compareRight.filename]
        : compareMode === 'cross'
          ? !!currentCrossItem?.flagged
          : false
    }
    analyzing={
      compareMode === 'manual'
        ? analyzing
        : compareMode === 'cross'
          ? (crossPanel?.getCrossState()?.aiTriageRunning ?? false)
          : false
    }
    recomparing={compareMode === 'manual' ? comparing : false}
    onClose={closeCompareFullscreen}
  />
{/if}

<!-- Bulk Action Bar -->
{#if selectedCount > 0 && activeTab !== 'compare' && activeTab !== 'cross'}
  <BulkActionBar
    {selectedCount}
    selectedApprovableCount={selectedApprovable.length}
    selectedRejectableCount={selectedRejectable.length}
    {bulkOperating}
    {bulkProgress}
    {bulkTotal}
    onApprove={handleBulkApprove}
    onReject={handleBulkReject}
    onRerun={handleBulkRerun}
    onAITriage={() => handleAITriage([...selectedImages])}
    aiTriageRunning={analyzing}
    onDelete={handleBulkDelete}
  />
{/if}
{#if activeTab === 'cross' && (crossPanel?.getCrossState()?.selectedCrossCount ?? 0) > 0}
  {@const crossState = crossPanel?.getCrossState()}
  <BulkActionBar
    selectedCount={crossState?.selectedCrossCount ?? 0}
    mode="cross"
    crossRunning={crossState?.crossCompareRunning || crossState?.crossTestRunning || crossState?.crossApproveRunning || false}
    bulkOperating={crossState?.crossApproveRunning || false}
    bulkProgress={crossState?.crossApproveProgress || 0}
    bulkTotal={crossState?.crossApproveTotal || 0}
    onApprove={() => crossPanel?.approveSelectedCrossItems()}
    onRerun={() => crossPanel?.rerunSelectedCrossItems()}
    onRerunTests={() => crossPanel?.rerunSelectedCrossItemTests()}
    onAITriage={() => {
      const keys = crossState?.selectedCrossItems ? [...crossState.selectedCrossItems] : undefined;
      crossPanel?.runAITriage(keys);
    }}
    aiTriageRunning={crossState?.aiTriageRunning || false}
    onDelete={() => crossPanel?.deleteCrossItems()}
  />
{/if}

<!-- Toast Notification -->
{#if toastMessage}
  <div class="toast" class:success={toastType === 'success'} class:error={toastType === 'error'}>
    {toastMessage}
  </div>
{/if}

<!-- Fullscreen Gallery -->
{#if showGallery && orderedGalleryQueue.length > 0}
  <FullscreenGallery
    queue={orderedGalleryQueue}
    initialIndex={galleryStartIndex}
    baselines={store.baselines}
    diffs={store.diffs}
    onClose={closeGallery}
    onApprove={handleGalleryApprove}
    onReject={handleGalleryReject}
    onFlag={handleGalleryFlag}
    onUnflag={handleGalleryUnflag}
    onRerun={handleRerun}
    onAnalyze={(filename) => filename && handleAITriage([filename])}
    analyzing={analyzing}
    testRunning={!!testState}
    {getImageUrl}
    getImageMetadata={(type, filename) => store.getMetadataForType(type, filename)}
  />
{/if}

<style>
  .project-page {
    max-width: 1400px;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    min-height: calc(100vh - 100px);
    font-family: var(--font-body);
    --tag-approved: #22c55e;
    --tag-flagged: #ff6b00;
    --tag-unapproved: #ef4444;
    --tag-new: #f59e0b;
    --tag-diff: #f97316;
    --tag-passed: #38bdf8;
    --tag-smart: #14b8a6;
    --tag-auto-review: #eab308;
  }

  .btn {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 1rem;
    border: 1px solid var(--border);
    border-radius: 0;
    background: var(--panel-strong);
    color: var(--text-strong);
    font-family: var(--font-mono);
    font-size: 0.8rem;
    cursor: pointer;
    transition: background 0.2s, border-color 0.2s;
    text-transform: lowercase;
    letter-spacing: 0.03em;
  }

  .btn:hover {
    border-color: var(--text-muted);
    background: var(--border);
  }

  .btn.primary {
    background: transparent;
    border-color: var(--accent);
    color: var(--accent);
  }

  .btn.primary:hover {
    background: var(--accent);
    color: var(--bg);
  }

  .btn.warning {
    border-color: #f59e0b;
    color: #f59e0b;
    background: transparent;
  }

  .btn.warning:hover {
    background: #f59e0b;
    color: var(--bg);
  }

  .btn.danger {
    border-color: #ef4444;
    color: #ef4444;
    background: transparent;
  }

  .btn.danger:hover {
    background: #ef4444;
    color: var(--bg);
  }

  .btn.small {
    padding: 0.375rem 0.75rem;
    font-size: 0.8rem;
  }

  .btn.active {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--bg);
  }

  .btn.ghost {
    background: transparent;
    border: 1px solid var(--border);
    color: var(--text-muted);
  }

  .btn.ghost:hover:not(:disabled) {
    border-color: var(--accent);
    color: var(--accent);
  }

  .error {
    background: rgba(239, 68, 68, 0.08);
    border: 1px solid #ef4444;
    border-left: 3px solid #ef4444;
    padding: 0.75rem 1rem;
    border-radius: 0;
    margin-bottom: 1rem;
    font-family: var(--font-mono);
  }

  .test-error {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .error-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .error-close {
    background: none;
    border: none;
    color: #ef4444;
    font-size: 1.5rem;
    cursor: pointer;
    padding: 0;
    line-height: 1;
  }

  .error-close:hover {
    color: var(--text-strong);
  }

  .error-message {
    font-family: var(--font-mono);
    font-size: 0.8rem;
    white-space: pre-wrap;
    color: #fca5a5;
  }

  .warning {
    background: rgba(245, 158, 11, 0.08);
    border: 1px solid rgba(245, 158, 11, 0.6);
    border-left: 3px solid #f59e0b;
    padding: 0.75rem 1rem;
    border-radius: 0;
    margin-bottom: 1rem;
    font-family: var(--font-mono);
    color: #fcd34d;
  }

  .warning-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-size: 0.82rem;
    margin-bottom: 0.35rem;
  }

  .warning-close {
    background: none;
    border: none;
    color: #f59e0b;
    font-size: 1.2rem;
    cursor: pointer;
    padding: 0;
    line-height: 1;
  }

  .warning-list {
    margin: 0;
    padding-left: 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    font-size: 0.76rem;
  }

  .warning-meta {
    margin-top: 0.45rem;
    font-size: 0.72rem;
    color: var(--text-muted);
  }

  .warning-samples {
    margin-top: 0.3rem;
    font-size: 0.72rem;
    color: var(--text-muted);
    word-break: break-word;
  }

  .test-warning-inline {
    margin-bottom: 0.75rem;
  }

  .loading, .empty {
    text-align: center;
    padding: 3rem;
    color: var(--text-muted);
  }

  .status-grid {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .status-card {
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 0;
    padding: 0.65rem 0.9rem;
    text-align: center;
    font: inherit;
    color: inherit;
  }

  .status-card.clickable {
    cursor: pointer;
    transition: border-color 0.2s;
  }

  .status-card.clickable:hover {
    border-color: var(--text-muted);
  }

  .status-card.clickable.active {
    border-color: var(--accent);
    background: var(--panel-strong);
  }

  .status-value {
    font-family: var(--font-mono);
    font-size: 1.35rem;
    font-weight: 600;
    margin-bottom: 0.25rem;
  }

  .status-label {
    font-family: var(--font-mono);
    font-size: 0.7rem;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }

  .status-card.passed .status-value {
    color: #22c55e;
  }

  .status-card.failed .status-value {
    color: var(--text-muted);
  }

  .status-card.failed.highlight .status-value {
    color: #ef4444;
  }

  .status-card.new .status-value {
    color: #f59e0b;
  }

  .status-card.total .status-value {
    color: var(--accent);
  }

  .tabs {
    display: flex;
    gap: 0;
    margin-bottom: 1rem;
    border-bottom: 1px solid var(--border);
  }

  .tab {
    padding: 0.5rem 1rem;
    background: transparent;
    border: none;
    border-bottom: 2px solid transparent;
    border-radius: 0;
    color: var(--text-muted);
    font-family: var(--font-mono);
    font-size: 0.8rem;
    cursor: pointer;
    transition: color 0.2s, border-color 0.2s;
    text-transform: lowercase;
    letter-spacing: 0.03em;
  }

  .tab:hover {
    color: var(--text-strong);
  }

  .tab.active {
    background: transparent;
    color: var(--accent);
    border-bottom-color: var(--accent);
  }

  .content {
    flex: 1;
    display: grid;
    grid-template-columns: 1fr;
    gap: 1rem;
    min-height: 400px;
    margin-bottom: 1rem;
  }

  .image-panel {
    display: flex;
    flex-direction: column;
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 0;
    overflow: hidden;
  }

  .search-bar {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.75rem;
    background: var(--bg);
    border-bottom: 1px solid var(--border);
    flex-wrap: wrap;
  }

  .search-bar .search-input {
    flex: 1;
    min-width: 220px;
    padding: 0.5rem 0.75rem;
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 0;
    color: var(--text-strong);
    font-family: var(--font-mono);
    font-size: 0.8rem;
  }

  .search-bar .search-input:focus {
    outline: none;
    border-color: var(--accent);
  }

  .search-bar .search-input::placeholder {
    color: var(--text-muted);
  }

  .search-bar .clear-btn {
    background: none;
    border: none;
    color: var(--text-muted);
    font-size: 1.25rem;
    cursor: pointer;
    padding: 0 0.25rem;
    line-height: 1;
  }

  .search-bar .clear-btn:hover {
    color: var(--text-strong);
  }

  .search-bar .result-count {
    font-size: 0.75rem;
    color: var(--text-muted);
    white-space: nowrap;
  }

  .tag-filters {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
    align-items: center;
  }

  .tag-filter {
    padding: 0.25rem 0.5rem;
    border-radius: 0;
    border: 1px solid var(--border);
    background: transparent;
    color: var(--text-muted);
    font-family: var(--font-mono);
    font-size: 0.65rem;
    text-transform: lowercase;
    letter-spacing: 0.05em;
    cursor: pointer;
    opacity: 0.55;
    transition: opacity 0.15s, border-color 0.15s, color 0.15s, background 0.15s;
  }

  .tag-filter.active {
    opacity: 1;
    color: var(--text-strong);
  }

  .tag-filter.tag-approved {
    border-color: rgba(34, 197, 94, 0.4);
    background: rgba(34, 197, 94, 0.12);
    color: var(--tag-approved);
  }

  .tag-filter.tag-smart {
    border-color: rgba(20, 184, 166, 0.4);
    background: rgba(20, 184, 166, 0.12);
    color: var(--tag-smart);
  }

  .tag-filter.tag-unapproved {
    border-color: rgba(239, 68, 68, 0.4);
    background: rgba(239, 68, 68, 0.12);
    color: var(--tag-unapproved);
  }

  .tag-filter.tag-new {
    border-color: rgba(245, 158, 11, 0.45);
    background: rgba(245, 158, 11, 0.12);
    color: var(--tag-new);
  }

  .tag-filter.tag-diff {
    border-color: rgba(249, 115, 22, 0.45);
    background: rgba(249, 115, 22, 0.12);
    color: var(--tag-diff);
  }

  .tag-filter.tag-auto-review {
    border-color: rgba(234, 179, 8, 0.45);
    background: rgba(234, 179, 8, 0.12);
    color: var(--tag-auto-review);
  }

  .tag-filter.tag-passed {
    border-color: rgba(56, 189, 248, 0.45);
    background: rgba(56, 189, 248, 0.12);
    color: var(--tag-passed);
  }

  .selection-controls {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-left: auto;
    padding-left: 1rem;
    border-left: 1px solid var(--border);
  }

  .selected-count {
    font-size: 0.8rem;
    color: var(--accent);
    font-weight: 500;
  }

  .btn.small.expanded {
    background: var(--accent);
    color: #fff;
  }

  .btn.small.all-selected {
    background: #22c55e;
    color: #fff;
  }

  .btn.small.rerun {
    background: transparent;
    border: 1px solid var(--accent);
    color: var(--accent);
  }

  .btn.small.rerun:hover:not(:disabled) {
    background: var(--accent);
    color: #fff;
  }

  .pagination {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 1rem;
    padding: 0.75rem;
    border-bottom: 1px solid var(--border);
    background: var(--bg);
  }

  .page-info {
    font-size: 0.8rem;
    color: var(--text-muted);
  }

  .image-count {
    padding: 0.5rem 1rem;
    font-size: 0.8rem;
    color: var(--text-muted);
    border-bottom: 1px solid var(--border);
    background: var(--bg);
  }

  .image-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 0.75rem;
    padding: 0.75rem;
    overflow-y: auto;
    align-content: start;
    flex: 1;
  }

  .image-card {
    background: var(--panel-soft);
    border: 1px solid var(--border-soft);
    border-radius: 0;
    padding: 0.6rem;
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    cursor: pointer;
    transition: border-color 0.15s;
    contain: layout style paint;
    content-visibility: auto;
    contain-intrinsic-size: auto 220px auto 210px;
  }

  .image-card:hover {
    border-color: var(--text-muted);
  }

  .image-card.multi-selected {
    border-color: var(--accent);
  }

  .image-card.tag-approved {
    border-color: rgba(34, 197, 94, 0.6);
  }

  .image-card.tag-unapproved {
    border-color: rgba(239, 68, 68, 0.6);
  }

  .image-card.tag-new {
    border-color: rgba(245, 158, 11, 0.7);
  }

  .image-card.tag-diff {
    border-color: rgba(249, 115, 22, 0.7);
  }

  .image-card.tag-auto-review {
    border-color: rgba(234, 179, 8, 0.7);
  }

  .image-card.tag-passed {
    border-color: rgba(56, 189, 248, 0.7);
  }

  .image-card-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 0.6rem;
  }

  .image-card-title {
    min-width: 0;
  }

  .image-title {
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--text-strong);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .image-meta {
    font-size: 0.7rem;
    color: var(--text-muted);
    margin-top: 0.15rem;
  }

  .image-tag {
    font-family: var(--font-mono);
    font-size: 0.6rem;
    font-weight: 500;
    text-transform: lowercase;
    letter-spacing: 0.05em;
    padding: 0.15rem 0.4rem;
    border-radius: 0;
    border: 1px solid var(--border);
    background: transparent;
    color: var(--text-muted);
    white-space: nowrap;
  }

  .image-tag.tag-approved {
    border-color: rgba(34, 197, 94, 0.4);
    background: rgba(34, 197, 94, 0.12);
    color: var(--tag-approved);
  }

  .image-tag.tag-unapproved {
    border-color: rgba(239, 68, 68, 0.4);
    background: rgba(239, 68, 68, 0.12);
    color: var(--tag-unapproved);
  }

  .image-tag.tag-new {
    border-color: rgba(245, 158, 11, 0.45);
    background: rgba(245, 158, 11, 0.12);
    color: var(--tag-new);
  }

  .image-tag.tag-diff {
    border-color: rgba(249, 115, 22, 0.45);
    background: rgba(249, 115, 22, 0.12);
    color: var(--tag-diff);
  }

  .image-tag.tag-auto-review {
    border-color: rgba(234, 179, 8, 0.45);
    background: rgba(234, 179, 8, 0.12);
    color: var(--tag-auto-review);
  }

  .image-tag.tag-passed {
    border-color: rgba(56, 189, 248, 0.45);
    background: rgba(56, 189, 248, 0.12);
    color: var(--tag-passed);
  }

  .image-thumb {
    position: relative;
    height: 120px;
    background: var(--panel-strong);
    border: 1px solid var(--border);
    border-radius: 0;
    overflow: hidden;
  }

  .checkbox-wrapper {
    position: absolute;
    top: 6px;
    left: 6px;
    z-index: 2;
    opacity: 0;
    transition: opacity 0.15s;
  }

  .checkbox-wrapper.visible,
  .image-card:hover .checkbox-wrapper {
    opacity: 1;
  }

  .checkbox-wrapper input {
    position: absolute;
    opacity: 0;
    cursor: pointer;
    height: 0;
    width: 0;
  }

  .checkmark {
    display: block;
    width: 18px;
    height: 18px;
    background: rgba(0, 0, 0, 0.6);
    border: 2px solid var(--text-muted);
    border-radius: 0;
    cursor: pointer;
    transition: all 0.15s;
  }

  .checkbox-wrapper:hover .checkmark {
    border-color: var(--accent);
  }

  .checkbox-wrapper input:checked ~ .checkmark {
    background: var(--accent);
    border-color: var(--accent);
  }

  .checkbox-wrapper input:checked ~ .checkmark::after {
    content: '';
    position: absolute;
    left: 6px;
    top: 2px;
    width: 4px;
    height: 8px;
    border: solid var(--text-strong);
    border-width: 0 2px 2px 0;
    transform: rotate(45deg);
  }

  .image-placeholder {
    position: absolute;
    inset: 0;
    background: linear-gradient(135deg, var(--panel) 25%, var(--panel-soft) 50%, var(--panel) 75%);
    background-size: 200% 200%;
    animation: shimmer 1.5s infinite;
  }

  @keyframes shimmer {
    0% { background-position: 200% 0; }
    100% { background-position: -200% 0; }
  }

  .image-thumb img {
    width: 100%;
    height: 100%;
    object-fit: contain;
    opacity: 0;
    transition: opacity 0.2s;
  }

  .image-thumb img.loaded {
    opacity: 1;
  }

  .image-name {
    padding: 0.25rem 0.35rem 0.1rem;
    font-size: 0.65rem;
    color: var(--text-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    border-top: 1px solid transparent;
  }


  /* Compare tab styles */
  .compare-content {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    overflow-y: auto;
  }

  .compare-hint {
    text-align: center;
    padding: 3rem;
    color: var(--text-muted);
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 0;
    font-family: var(--font-mono);
  }

  .compare-results {
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 0;
    padding: 1rem;
  }

  /* Cross compare styles */
  .cross-content {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .cross-toolbar {
    display: flex;
    align-items: flex-end;
    flex-wrap: wrap;
    gap: 0.75rem;
    justify-content: space-between;
  }

  .cross-pair-filters {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.6rem;
  }

  .pair-filter-label {
    font-size: 0.7rem;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }

  .cross-select label {
    display: block;
    font-size: 0.75rem;
    color: var(--text-muted);
    margin-bottom: 0.35rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }

  .cross-select {
    min-width: 240px;
    flex: 1;
  }

  .cross-select select {
    width: 100%;
    padding: 0.6rem 0.75rem;
    background: var(--panel-strong);
    border: 1px solid var(--border);
    border-radius: 0;
    color: var(--text);
    font-family: var(--font-mono);
    font-size: 0.8rem;
  }

  .cross-search-bar {
    border-radius: 0;
  }

  .cross-search-bar .search-input {
    min-width: 240px;
  }

  .cross-selection-controls {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-left: auto;
    padding-left: 1rem;
    border-left: 1px solid var(--border);
  }

  .cross-summary-line {
    font-family: var(--font-mono);
    font-size: 0.75rem;
    color: var(--text-muted);
    padding: 0.45rem 0.65rem;
    border-radius: 0;
    border: 1px solid var(--border);
    background: var(--panel);
  }

  .cross-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 1rem;
  }

  .cross-card {
    background: var(--panel-soft);
    border: 1px solid var(--border-soft);
    border-radius: 0;
    padding: 0.8rem;
    display: flex;
    flex-direction: column;
    gap: 0.8rem;
    content-visibility: auto;
    contain: layout paint;
    contain-intrinsic-size: 280px 260px;
  }

  .cross-card.tag-approved {
    border-color: rgba(34, 197, 94, 0.6);
  }

  .cross-card.tag-smart {
    border-color: rgba(20, 184, 166, 0.6);
  }

  .cross-card.tag-unapproved {
    border-color: rgba(239, 68, 68, 0.6);
  }

  .cross-card.tag-new {
    border-color: rgba(245, 158, 11, 0.7);
  }

  .cross-card.tag-diff {
    border-color: rgba(249, 115, 22, 0.7);
  }

  .cross-card.tag-passed {
    border-color: rgba(56, 189, 248, 0.7);
  }

  .cross-card-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
  }

  .cross-select-box {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border-radius: 0;
    border: 1px solid var(--border);
    background: var(--panel-strong);
  }

  .cross-select-box input {
    width: 14px;
    height: 14px;
    accent-color: var(--accent);
  }

  .cross-title {
    font-size: 0.95rem;
    font-weight: 600;
    color: var(--text-strong);
  }

  .cross-meta {
    font-size: 0.75rem;
    color: var(--text-muted);
  }

  .cross-badge {
    font-family: var(--font-mono);
    font-size: 0.65rem;
    font-weight: 500;
    padding: 0.15rem 0.4rem;
    border-radius: 0;
    text-transform: lowercase;
    letter-spacing: 0.05em;
    border: 1px solid var(--border);
    background: transparent;
    color: var(--text-muted);
  }

  .cross-badge.tag-approved {
    background: rgba(34, 197, 94, 0.12);
    border-color: rgba(34, 197, 94, 0.4);
    color: var(--tag-approved);
  }

  .cross-badge.tag-smart {
    background: rgba(20, 184, 166, 0.12);
    border-color: rgba(20, 184, 166, 0.4);
    color: var(--tag-smart);
  }

  .cross-badge.tag-unapproved {
    background: rgba(239, 68, 68, 0.12);
    border-color: rgba(239, 68, 68, 0.4);
    color: var(--tag-unapproved);
  }

  .cross-badge.tag-new {
    background: rgba(245, 158, 11, 0.12);
    border-color: rgba(245, 158, 11, 0.45);
    color: var(--tag-new);
  }

  .cross-badge.tag-diff {
    background: rgba(249, 115, 22, 0.12);
    border-color: rgba(249, 115, 22, 0.45);
    color: var(--tag-diff);
  }

  .cross-badge.tag-passed {
    background: rgba(56, 189, 248, 0.12);
    border-color: rgba(56, 189, 248, 0.45);
    color: var(--tag-passed);
  }

  .cross-stats {
    display: flex;
    flex-wrap: wrap;
    gap: 0.6rem;
    font-size: 0.75rem;
    color: var(--text-muted);
  }

  .cross-images {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 0.5rem;
  }

  .cross-actions {
    display: flex;
    justify-content: flex-end;
    align-items: center;
    gap: 0.5rem;
  }

  .cross-actions .btn {
    padding: 0.35rem 0.75rem;
  }

  .cross-image {
    background: var(--panel-strong);
    border: 1px solid var(--border-soft);
    border-radius: 0;
    padding: 0;
    overflow: hidden;
    cursor: pointer;
  }

  .cross-image img {
    width: 100%;
    height: 90px;
    object-fit: cover;
    display: block;
  }

  .threshold-control {
    display: flex;
    align-items: center;
    gap: 1rem;
    margin-bottom: 1rem;
    padding-bottom: 1rem;
    border-bottom: 1px solid var(--border);
  }

  .threshold-label {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    flex: 1;
    font-size: 0.875rem;
    color: var(--text-muted);
  }

  .threshold-label span {
    min-width: 70px;
  }

  .threshold-input {
    width: 70px;
    padding: 0.375rem 0.5rem;
    background: var(--panel-strong);
    border: 1px solid var(--border);
    border-radius: 0;
    color: var(--text);
    font-family: var(--font-mono);
    font-size: 0.8rem;
    text-align: center;
  }

  .threshold-input:focus {
    outline: none;
    border-color: var(--accent);
  }

  .threshold-slider {
    flex: 1;
    height: 4px;
    -webkit-appearance: none;
    appearance: none;
    background: var(--border);
    border-radius: 0;
    outline: none;
    cursor: pointer;
  }

  .threshold-slider::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 14px;
    height: 14px;
    border-radius: 0;
    background: var(--accent);
    cursor: pointer;
    transition: background 0.15s;
  }

  .threshold-slider::-webkit-slider-thumb:hover {
    background: var(--accent-strong);
  }

  .threshold-slider::-moz-range-thumb {
    width: 14px;
    height: 14px;
    border-radius: 0;
    background: var(--accent);
    cursor: pointer;
    border: none;
  }

  .compare-stats {
    display: flex;
    gap: 1.5rem;
    margin-bottom: 1rem;
    padding-bottom: 1rem;
    border-bottom: 1px solid var(--border);
  }

  .stat {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .stat-label {
    font-family: var(--font-mono);
    font-size: 0.7rem;
    color: var(--text-muted);
    text-transform: lowercase;
    letter-spacing: 0.05em;
  }

  .stat-value {
    font-family: var(--font-mono);
    font-size: 1.25rem;
    font-weight: 600;
    color: var(--text-strong);
  }

  .compare-images {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 1rem;
  }

  .compare-image-card {
    position: relative;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 0;
    overflow: hidden;
  }

  .compare-image-card img {
    width: 100%;
    display: block;
  }

  .compare-image-card.clickable {
    cursor: pointer;
    transition: border-color 0.15s;
  }

  .compare-image-card.clickable:hover {
    border-color: var(--text-muted);
  }


  /* Project meta section */
  .project-meta {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 0.75rem;
    padding: 1rem;
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 0;
    margin-bottom: 1rem;
  }

  .meta-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    flex-wrap: wrap;
  }

  .meta-row-secondary {
    justify-content: flex-start;
  }

  .missing-tests-row {
    border: 1px solid rgba(245, 158, 11, 0.5);
    background: rgba(245, 158, 11, 0.08);
    padding: 0.6rem 0.75rem;
    gap: 0.75rem;
  }

  .missing-tests-message {
    font-family: var(--font-mono);
    font-size: 0.78rem;
    color: #f59e0b;
  }

  .missing-tests-actions {
    margin-left: auto;
    display: flex;
    align-items: center;
    gap: 0.45rem;
  }

  .config-summary {
    display: flex;
    gap: 1.5rem;
    flex-wrap: wrap;
  }

  .config-item {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .config-value {
    font-family: var(--font-mono);
    font-size: 1.25rem;
    font-weight: 600;
    color: var(--text);
  }

  .config-label {
    font-family: var(--font-mono);
    font-size: 0.65rem;
    color: var(--text-muted);
    text-transform: lowercase;
    letter-spacing: 0.05em;
  }

  .last-run {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.8rem;
    color: var(--text-muted);
  }

  .last-run-time {
    color: var(--text);
  }

  .last-status-badge {
    font-family: var(--font-mono);
    font-size: 0.65rem;
    padding: 0.15rem 0.35rem;
    border-radius: 0;
    text-transform: lowercase;
    font-weight: 500;
    color: var(--text-strong);
    border: 1px solid var(--border);
  }

  .timing-stats {
    display: flex;
    gap: 0.75rem;
    margin-top: 0.5rem;
  }

  .timing {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    font-size: 0.7rem;
    color: var(--text-muted);
  }

  .timing svg {
    opacity: 0.6;
  }

  .timing.total {
    color: var(--accent);
  }

  .timing.total svg {
    opacity: 1;
  }

  .danger-zone {
    text-align: center;
    padding-bottom: 1rem;
  }

  .btn-text-danger {
    background: none;
    border: none;
    color: #ef4444;
    font-size: 0.75rem;
    cursor: pointer;
    padding: 0.5rem;
    transition: color 0.2s;
  }

  .btn-text-danger:hover {
    color: #f87171;
  }

  /* Bulk Action Bar */
  .bulk-action-bar {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 1rem 2rem;
    background: var(--panel);
    border-top: 1px solid var(--border);
    box-shadow: 0 -4px 12px rgba(0, 0, 0, 0.3);
    z-index: 100;
    animation: slideUp 0.2s ease-out;
  }

  @keyframes slideUp {
    from {
      transform: translateY(100%);
      opacity: 0;
    }
    to {
      transform: translateY(0);
      opacity: 1;
    }
  }

  .bulk-action-bar.operating {
    background: var(--panel-strong);
  }

  .bulk-info {
    display: flex;
    align-items: center;
    gap: 1rem;
  }

  .bulk-count {
    font-size: 1rem;
    font-weight: 600;
    color: var(--text-strong);
  }

  .bulk-progress {
    font-size: 0.875rem;
    color: var(--accent);
  }

  .bulk-actions {
    display: flex;
    gap: 0.75rem;
  }

  /* Toast Notification */
  .toast {
    position: fixed;
    bottom: 80px;
    left: 50%;
    transform: translateX(-50%);
    padding: 0.75rem 1.5rem;
    border-radius: 0;
    font-family: var(--font-mono);
    font-size: 0.8rem;
    font-weight: 500;
    z-index: 200;
    animation: fadeInUp 0.3s ease-out;
  }

  @keyframes fadeInUp {
    from {
      transform: translateX(-50%) translateY(20px);
      opacity: 0;
    }
    to {
      transform: translateX(-50%) translateY(0);
      opacity: 1;
    }
  }

  .toast.success {
    background: #166534;
    color: var(--text-strong);
    border: 1px solid #22c55e;
  }

  .toast.error {
    background: #7f1d1d;
    color: var(--text-strong);
    border: 1px solid #ef4444;
  }

  @media (max-width: 768px) {
    .status-grid {
      width: 100%;
      justify-content: flex-start;
    }

    .content {
      grid-template-columns: 1fr;
    }

    .project-meta {
      gap: 1rem;
    }

    .meta-row {
      align-items: flex-start;
    }

    .missing-tests-actions {
      margin-left: 0;
      width: 100%;
      justify-content: flex-start;
      flex-wrap: wrap;
    }

    .selection-controls {
      display: none;
    }
  }
</style>
