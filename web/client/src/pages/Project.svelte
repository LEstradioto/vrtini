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
    type Acceptance,
    type AIAnalysisResult,
    type ImageResult,
    type CrossReport,
    type CrossResults,
    type CrossResultItem,
    type CrossResultsSummary,
    type VRTConfig,
    type AutoThresholdCaps
  } from '../lib/api';
  import CompareSelector from '../components/CompareSelector.svelte';
  import AIAnalysisModal from '../components/AIAnalysisModal.svelte';
  import FullscreenGallery from '../components/FullscreenGallery.svelte';
  import ProjectHeader from '../components/ProjectHeader.svelte';

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

  interface TestState {
    jobId: string;
    progress: number;
    total: number;
    aborting?: boolean;
    phase?: string;
  }

  let {
    projectId,
    navigate,
    runningTests,
    startTest,
    abortTest,
    rerunImage,
    testErrors,
    clearTestError,
    initialTab,
  } = $props<{
    projectId: string;
    navigate: (path: string) => void;
    runningTests: Map<string, TestState>;
    startTest: (project: ProjectType, onComplete?: () => void) => Promise<void>;
    abortTest: (projectId: string) => Promise<void>;
    rerunImage: (project: ProjectType, filenames: string | string[], onComplete?: () => void) => Promise<void>;
    testErrors: Map<string, string>;
    clearTestError: (projectId: string) => void;
    initialTab?: 'baselines' | 'tests' | 'diffs' | 'compare' | 'cross';
  }>();

  // Constants
  const DEFAULT_COMPARISON_THRESHOLD = 0.1;
  const PAGE_SIZE = 56;
  const CROSS_PAGE_SIZE = 24;

  function formatDuration(ms?: number): string {
    if (!ms) return '-';
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  }

  function getErrorMessage(err: unknown, fallback: string): string {
    return err instanceof Error ? err.message : fallback;
  }

  async function runCrossCompare(options?: {
    key?: string;
    itemKeys?: string[];
    resetAcceptances?: boolean;
  }) {
    if (!project) return;
    crossCompareRunning = true;
    crossCompareError = null;
    try {
      await crossCompare.run(project.id, options);
      const list = await crossCompare.list(project.id);
      crossReports = list.results;
      const nextKey = options?.key ?? crossReports[0]?.key ?? null;
      if (nextKey) {
        selectedCrossKey = nextKey;
        await loadCrossResults(nextKey);
        activeTab = 'cross';
      }
    } catch (err) {
      crossCompareError = getErrorMessage(err, 'Cross compare failed');
    } finally {
      crossCompareRunning = false;
    }
  }

  async function runSelectedCrossPair() {
    if (!selectedCrossKey) return;
    await runCrossCompare({ key: selectedCrossKey });
  }

  async function rerunSelectedCrossItems() {
    if (!selectedCrossKey || selectedCrossItems.size === 0) return;
    await runCrossCompare({
      key: selectedCrossKey,
      itemKeys: [...selectedCrossItems],
      resetAcceptances: true,
    });
  }

  async function rerunFilteredCrossItems() {
    if (!selectedCrossKey || crossFilteredItems.length === 0) return;
    const itemKeys = crossFilteredItems.map(
      (item) => item.itemKey ?? `${item.scenario}__${item.viewport}`
    );
    await runCrossCompare({
      key: selectedCrossKey,
      itemKeys,
      resetAcceptances: true,
    });
  }

  async function clearCrossPair() {
    if (!project || !selectedCrossKey) return;
    if (!confirm(`Delete cross compare results for "${selectedCrossKey}"? This will remove reports, diffs, and approvals.`)) {
      return;
    }

    crossResultsError = null;
    try {
      await crossCompare.clear(project.id, selectedCrossKey);
      const list = await crossCompare.list(project.id);
      crossReports = list.results;

      if (crossReports.length > 0) {
        const nextKey = crossReports[0].key;
        selectedCrossKey = nextKey;
        await loadCrossResults(nextKey);
      } else {
        selectedCrossKey = null;
        crossResults = null;
      }
    } catch (err) {
      crossResultsError = getErrorMessage(err, 'Failed to clear cross compare results');
    }
  }

  async function deleteCrossItems() {
    if (!project || !selectedCrossKey || selectedCrossItems.size === 0) return;
    const itemKeys = [...selectedCrossItems];

    if (!confirm(`Delete ${itemKeys.length} cross compare item(s)? This will hide them from results.`)) {
      return;
    }

    crossResultsError = null;
    try {
      await crossCompare.deleteItems(project.id, selectedCrossKey, itemKeys);
      selectedCrossItems = new Set();
      await loadCrossResults(selectedCrossKey);
      await refreshCrossReports();
    } catch (err) {
      crossResultsError = getErrorMessage(err, 'Failed to delete cross compare items');
    }
  }

  async function deleteCrossItem(item: CrossResultItem) {
    if (!project || !selectedCrossKey) return;
    const itemKey = item.itemKey ?? `${item.scenario}__${item.viewport}`;
    if (!itemKey) return;
    crossResultsError = null;
    try {
      await crossCompare.deleteItems(project.id, selectedCrossKey, [itemKey]);
      await loadCrossResults(selectedCrossKey);
      await refreshCrossReports();
    } catch (err) {
      crossResultsError = getErrorMessage(err, 'Failed to delete cross compare item');
    }
  }

  async function loadCrossResults(key: string) {
    if (!project) return;
    crossResultsLoading = true;
    crossResultsError = null;
    try {
      const result = await crossCompare.getResults(project.id, key);
      crossResults = result.results;
      selectedCrossItems = new Set();
    } catch (err) {
      crossResultsError = getErrorMessage(err, 'Failed to load cross compare results');
    } finally {
      crossResultsLoading = false;
    }
  }

  async function refreshCrossReports() {
    if (!project) return;
    try {
      const list = await crossCompare.list(project.id);
      crossReports = list.results;
    } catch (err) {
      crossResultsError = getErrorMessage(err, 'Failed to refresh cross compare pairs');
    }
  }

  async function handleCrossPairChange(event: Event) {
    const target = event.target as HTMLSelectElement;
    const key = target.value;
    selectedCrossKey = key;
    if (key) {
      await loadCrossResults(key);
    }
  }

  async function approveCrossItem(item: CrossResultItem) {
    if (!project || !selectedCrossKey || !item.itemKey) return;
    try {
      await crossCompare.accept(project.id, selectedCrossKey, item.itemKey);
      await loadCrossResults(selectedCrossKey);
      await refreshCrossReports();
    } catch (err) {
      crossResultsError = getErrorMessage(err, 'Failed to approve cross item');
    }
  }

  async function revokeCrossItem(item: CrossResultItem) {
    if (!project || !selectedCrossKey || !item.itemKey) return;
    try {
      await crossCompare.revoke(project.id, selectedCrossKey, item.itemKey);
      await loadCrossResults(selectedCrossKey);
      await refreshCrossReports();
    } catch (err) {
      crossResultsError = getErrorMessage(err, 'Failed to revoke cross approval');
    }
  }

  async function approveCrossFromModal() {
    if (!currentCrossItem) return;
    await approveCrossItem(currentCrossItem);
    currentCrossItem = crossResults?.items.find((item) => item.itemKey === currentCrossItem?.itemKey) || currentCrossItem;
  }

  async function revokeCrossFromModal() {
    if (!currentCrossItem) return;
    await revokeCrossItem(currentCrossItem);
    currentCrossItem = crossResults?.items.find((item) => item.itemKey === currentCrossItem?.itemKey) || currentCrossItem;
  }

  // Core state
  let project = $state<ProjectType | null>(null);
  let loading = $state(true);
  let error = $state<string | null>(null);

  // Image arrays
  let baselines = $state<string[]>([]);
  let tests = $state<string[]>([]);
  let diffs = $state<string[]>([]);
  let baselinesMetadata = $state<ImageMetadata[]>([]);
  let testsMetadata = $state<ImageMetadata[]>([]);
  let diffsMetadata = $state<ImageMetadata[]>([]);
  let acceptances = $state<Record<string, Acceptance>>({});
  let imageResults = $state<Record<string, ImageResult>>({});
  let autoThresholdCaps = $state<AutoThresholdCaps | null>(null);

  // Config info
  let scenarioCount = $state(0);
  let browserCount = $state(0);
  let viewportCount = $state(0);
  let configData = $state<VRTConfig | null>(null);

  // Cross-compare state
  let crossCompareRunning = $state(false);
  let crossCompareError = $state<string | null>(null);
  let crossReports = $state<CrossResultsSummary[]>([]);
  let crossResults = $state<CrossResults | null>(null);
  let crossResultsLoading = $state(false);
  let crossResultsError = $state<string | null>(null);
  let selectedCrossKey = $state<string | null>(null);
  let crossSearchQuery = $state('');
  type CrossStatusFilter = 'all' | 'diffs' | 'matches' | 'smart' | 'approved' | 'unapproved';
  let crossStatusFilter = $state<Set<CrossStatusFilter>>(new Set(['all']));
  let crossPairFilter = $state<'all' | 'diffs' | 'issues' | 'smart' | 'approved' | 'matches'>('all');
  let crossHideApproved = $state(false);
  let crossCurrentPage = $state(0);

  // Cache-busting key for images (incremented after rerun)
  let imageCacheKey = $state(0);

  // Tab and view state
  let activeTab = $state<'baselines' | 'tests' | 'diffs' | 'compare' | 'cross'>(initialTab || 'tests');
  let tagFilter = $state<Set<ImageTag>>(new Set(['all']));

  // Pagination and filtering
  let currentPage = $state(0);
  let searchQuery = $state('');
  let debouncedSearchQuery = $state('');
  const SEARCH_DEBOUNCE_MS = 200;

  // Custom compare state
  type ImageType = 'baseline' | 'test' | 'diff';
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

  // Compare fullscreen modal state
  let showCompareFullscreen = $state(false);
  let compareImages = $state<{
    left: { src: string; label: string };
    right: { src: string; label: string };
    diff?: { src: string; label: string };
  } | null>(null);
  let compareFullscreenTitle = $state('');
  let compareMetrics = $state<{
    pixelDiff: number;
    diffPercentage: number;
    ssimScore?: number;
    phash?: { similarity: number; baselineHash: string; testHash: string };
  } | null>(null);
  let currentCrossItem = $state<CrossResultItem | null>(null);
  let crossQueueIndex = $state(0);
  let compareMode = $state<'manual' | 'cross' | null>(null);

  // Loaded images cache (for lazy loading)
  let loadedImages = $state<Set<string>>(new Set());

  // Multi-select state
  let selectedImages = $state<Set<string>>(new Set());
  let selectedCrossItems = $state<Set<string>>(new Set());
  let lastSelectedIndex = $state<number | null>(null);

  // Fullscreen gallery state
  let showGallery = $state(false);
  let galleryStartIndex = $state(0);

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
      baselines = imagesRes.baselines;
      tests = imagesRes.tests;
      diffs = imagesRes.diffs;
      baselinesMetadata = imagesRes.metadata?.baselines || [];
      testsMetadata = imagesRes.metadata?.tests || [];
      diffsMetadata = imagesRes.metadata?.diffs || [];
      acceptances = imagesRes.acceptances || {};
      autoThresholdCaps = imagesRes.autoThresholdCaps || null;
      imageResults = resultsRes.results;
      crossReports = crossRes.results;

      if (!selectedCrossKey && crossRes.results.length > 0) {
        selectedCrossKey = crossRes.results[0].key;
        await loadCrossResults(selectedCrossKey);
      }

      if (configRes?.config) {
        configData = configRes.config;
        scenarioCount = configRes.config.scenarios?.length || 0;
        browserCount = configRes.config.browsers?.length || 0;
        viewportCount = configRes.config.viewports?.length || 0;
      } else {
        configData = null;
        scenarioCount = 0;
        browserCount = 0;
        viewportCount = 0;
      }

      // Reset pagination when switching data
      currentPage = 0;
      loadedImages = new Set();
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

  type ImageStatus = 'passed' | 'failed' | 'new';
  type ImageTag =
    | 'all'
    | 'passed'
    | 'failed'
    | 'new'
    | 'approved'
    | 'unapproved'
    | 'diff'
    | 'auto-review';
  type DiffThreshold = { maxDiffPercentage?: number; maxDiffPixels?: number };
  type AutoThresholdReviewItem = {
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

  function getStatusColor(status?: ImageStatus) {
    switch (status) {
      case 'passed': return '#22c55e';
      case 'failed': return '#ef4444';
      case 'new': return '#f59e0b';
      default: return '#666';
    }
  }

  function getTagFor(filename: string): ImageTag {
    if (activeTab === 'diffs') {
      return autoThresholdReviewSet.has(filename) ? 'auto-review' : 'diff';
    }
    if (acceptances[filename]) return 'approved';
    const status = getImageStatus(filename);
    if (status === 'failed') return 'unapproved';
    if (status === 'new') return 'new';
    if (status === 'passed') return 'passed';
    return 'all';
  }

  function matchesTag(filename: string, tag: ImageTag): boolean {
    if (tag === 'all') return true;
    const fileTag = getTagFor(filename);
    if (tag === 'failed') {
      return fileTag === 'unapproved' || fileTag === 'diff' || fileTag === 'auto-review';
    }
    if (tag === 'diff') {
      return fileTag === 'diff' || fileTag === 'auto-review';
    }
    return fileTag === tag;
  }

  function matchesTagSet(filename: string, tags: Set<ImageTag>): boolean {
    if (tags.has('all')) return true;
    for (const tag of tags) {
      if (matchesTag(filename, tag)) return true;
    }
    return false;
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

  function matchesCrossStatus(item: CrossResultItem, status: CrossStatusFilter): boolean {
    switch (status) {
      case 'diffs':
        return !item.match;
      case 'matches':
        return item.match;
      case 'smart':
        return item.match && item.diffPercentage > 0;
      case 'approved':
        return !!item.accepted;
      case 'unapproved':
        return !item.accepted;
      default:
        return true;
    }
  }

  function matchesCrossStatusSet(
    item: CrossResultItem,
    statuses: Set<CrossStatusFilter>
  ): boolean {
    if (statuses.has('all')) return true;
    for (const status of statuses) {
      if (matchesCrossStatus(item, status)) return true;
    }
    return false;
  }

  function setCrossStatusFilter(status: CrossStatusFilter) {
    crossStatusFilter = new Set([status]);
  }

  function toggleCrossStatusFilter(status: CrossStatusFilter, event?: MouseEvent) {
    const multi = !!event?.metaKey || !!event?.ctrlKey;
    if (!multi) {
      setCrossStatusFilter(status);
      return;
    }
    if (status === 'all') {
      setCrossStatusFilter('all');
      return;
    }
    const next = new Set(crossStatusFilter);
    if (next.has('all')) next.delete('all');
    if (next.has(status)) {
      next.delete(status);
    } else {
      next.add(status);
    }
    if (next.size === 0) next.add('all');
    crossStatusFilter = next;
  }

  function isCrossStatusActive(status: CrossStatusFilter): boolean {
    if (crossStatusFilter.has('all')) return status === 'all';
    return crossStatusFilter.has(status);
  }

  function getTagLabel(tag: ImageTag): string {
    switch (tag) {
      case 'approved':
        return 'Approved';
      case 'unapproved':
        return 'Unapproved';
      case 'new':
        return 'New';
      case 'passed':
        return 'Passed';
      case 'diff':
        return 'Diff';
      case 'auto-review':
        return 'Auto Review';
      default:
        return 'All';
    }
  }

  function formatCrossPairSummary(report: CrossResultsSummary): string {
    const approved = report.approvedCount ?? 0;
    const smart = report.smartPassCount ?? 0;
    const match = report.matchCount ?? 0;
    const diff = report.diffCount ?? 0;
    const issue = report.issueCount ?? 0;
    return `A ${approved} · S ${smart} · M ${match} · D ${diff} · I ${issue}`;
  }

  // Derived counts
  let baselinesSet = $derived.by(() => new Set(baselines));
  let testsSet = $derived.by(() => new Set(tests));
  let diffsSet = $derived.by(() => new Set(diffs));
  let totalCount = $derived(Math.max(tests.length, baselines.length));
  let totalTab = $derived(tests.length >= baselines.length ? 'tests' : 'baselines');
  let failedCount = $derived(diffs.length);
  let newCount = $derived(tests.filter(t => !baselinesSet.has(t)).length);
  let passedCount = $derived(tests.filter(t => baselinesSet.has(t) && !diffsSet.has(t)).length);
  let testState = $derived(runningTests.get(projectId));
  let testError = $derived(testErrors.get(projectId));

  // Image lists based on active tab, filtered by tag if set
  let rawList = $derived.by(() => {
    let list: string[];
    switch (activeTab) {
      case 'baselines': list = baselines; break;
      case 'tests': list = tests; break;
      case 'diffs': list = diffs; break;
      case 'compare': return [];
      case 'cross': return [];
    }
    if (tagFilter.has('all')) return list;
    return list.filter((f) => matchesTagSet(f, tagFilter));
  });

  // Filter list by search query
  let fullList = $derived.by(() => {
    if (!debouncedSearchQuery.trim()) return rawList;
    const q = debouncedSearchQuery.toLowerCase();
    return rawList.filter(filename => filename.toLowerCase().includes(q));
  });

  let totalPages = $derived(Math.ceil(fullList.length / PAGE_SIZE));
  let currentList = $derived(fullList.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE));

  let filteredCrossReports = $derived.by(() => {
    if (crossPairFilter === 'all') return crossReports;
    return crossReports.filter((report) => {
      switch (crossPairFilter) {
        case 'diffs':
          return (report.diffCount ?? 0) > 0;
        case 'issues':
          return (report.issueCount ?? 0) > 0;
        case 'smart':
          return (report.smartPassCount ?? 0) > 0;
        case 'approved':
          return (report.approvedCount ?? 0) > 0;
        case 'matches':
          return (report.matchCount ?? 0) + (report.smartPassCount ?? 0) > 0;
        default:
          return true;
      }
    });
  });

  let crossPairCounts = $derived.by(() => {
    const counts = {
      all: crossReports.length,
      diffs: 0,
      issues: 0,
      smart: 0,
      approved: 0,
      matches: 0,
    };

    for (const report of crossReports) {
      if ((report.diffCount ?? 0) > 0) counts.diffs += 1;
      if ((report.issueCount ?? 0) > 0) counts.issues += 1;
      if ((report.smartPassCount ?? 0) > 0) counts.smart += 1;
      if ((report.approvedCount ?? 0) > 0) counts.approved += 1;
      if ((report.matchCount ?? 0) + (report.smartPassCount ?? 0) > 0) counts.matches += 1;
    }

    return counts;
  });

  let crossFilteredItems = $derived.by((): CrossResultItem[] => {
    if (!crossResults) return [];
    const q = crossSearchQuery.trim().toLowerCase();
    return crossResults.items.filter((item) => {
      if (crossHideApproved && item.accepted) return false;
      if (!matchesCrossStatusSet(item, crossStatusFilter)) return false;
      if (!q) return true;
      return `${item.scenario} ${item.viewport}`.toLowerCase().includes(q);
    });
  });

  let crossTotalPages = $derived(
    Math.ceil(crossFilteredItems.length / CROSS_PAGE_SIZE)
  );
  let crossCurrentList = $derived(
    crossFilteredItems.slice(
      crossCurrentPage * CROSS_PAGE_SIZE,
      (crossCurrentPage + 1) * CROSS_PAGE_SIZE
    )
  );

  $effect(() => {
    crossSearchQuery;
    crossStatusFilter;
    selectedCrossKey;
    crossCurrentPage = 0;
  });

  $effect(() => {
    const maxPage = Math.max(0, crossTotalPages - 1);
    if (crossCurrentPage > maxPage) {
      crossCurrentPage = maxPage;
    }
  });

  let crossPairSummary = $derived.by(() => {
    if (!crossResults) return null;
    const summary = {
      total: 0,
      approved: 0,
      smart: 0,
      match: 0,
      diff: 0,
      issue: 0,
    };

    for (const item of crossResults.items) {
      summary.total += 1;
      if (item.accepted) {
        summary.approved += 1;
        continue;
      }

      const smartPass = item.match && item.diffPercentage > 0;
      if (item.match) {
        if (smartPass) summary.smart += 1;
        else summary.match += 1;
        continue;
      }

      if (item.reason === 'diff') summary.diff += 1;
      else summary.issue += 1;
    }

    return summary;
  });

  $effect(() => {
    if (filteredCrossReports.length === 0) {
      if (selectedCrossKey) {
        selectedCrossKey = null;
        crossResults = null;
      }
      return;
    }

    const stillSelected = filteredCrossReports.some((report) => report.key === selectedCrossKey);
    if (!stillSelected) {
      selectedCrossKey = filteredCrossReports[0].key;
      loadCrossResults(selectedCrossKey);
    }
  });

  let selectedCrossCount = $derived(selectedCrossItems.size);
  let allCrossPageSelected = $derived(
    crossCurrentList.length > 0 &&
      crossCurrentList.every((item) =>
        selectedCrossItems.has(item.itemKey ?? `${item.scenario}__${item.viewport}`)
      )
  );
  let allCrossFilteredSelected = $derived(
    crossFilteredItems.length > 0 &&
      crossFilteredItems.every((item) =>
        selectedCrossItems.has(item.itemKey ?? `${item.scenario}__${item.viewport}`)
      )
  );

  function toggleCrossSelected(item: CrossResultItem) {
    const key = item.itemKey ?? `${item.scenario}__${item.viewport}`;
    const next = new Set(selectedCrossItems);
    if (next.has(key)) {
      next.delete(key);
    } else {
      next.add(key);
    }
    selectedCrossItems = next;
  }

  function selectAllCross() {
    if (crossFilteredItems.length === 0) return;
    if (allCrossFilteredSelected) return;
    if (allCrossPageSelected && crossTotalPages > 1) {
      selectedCrossItems = new Set(
        crossFilteredItems.map((item) => item.itemKey ?? `${item.scenario}__${item.viewport}`)
      );
    } else {
      selectedCrossItems = new Set(
        crossCurrentList.map((item) => item.itemKey ?? `${item.scenario}__${item.viewport}`)
      );
    }
  }

  let selectAllCrossLabel = $derived.by(() => {
    if (allCrossFilteredSelected) return `All (${crossFilteredItems.length})`;
    if (allCrossPageSelected && crossTotalPages > 1) return `All Pages (${crossFilteredItems.length})`;
    return 'Select All';
  });

  function deselectAllCross() {
    selectedCrossItems = new Set();
  }

  let crossCompareQueue = $derived.by(() => {
    if (!crossResults || !showCompareFullscreen || compareMode !== 'cross') return [];
    const baselineLabel = crossResults.baselineLabel || 'Baseline';
    const testLabel = crossResults.testLabel || 'Test';
    return crossFilteredItems.map((item) => ({
      images: {
        left: { src: getFileUrl(item.baseline), label: baselineLabel },
        right: { src: getFileUrl(item.test), label: testLabel },
        diff: item.diff ? { src: getFileUrl(item.diff), label: 'Diff' } : undefined,
      },
      title: `${item.scenario} · ${item.viewport}`,
      metrics: {
        pixelDiff: item.pixelDiff,
        diffPercentage: item.diffPercentage,
        ssimScore: item.ssimScore,
        phash: item.phash,
      },
      viewport: item.viewport,
      badge: {
        label: item.accepted
          ? 'Approved'
          : item.match
            ? item.diffPercentage > 0
              ? 'Smart Pass'
              : 'Match'
            : item.reason === 'diff'
              ? 'Diff'
              : 'Issue',
        tone: item.accepted
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
    }));
  });


  // Selected count for bulk action bar
  let selectedCount = $derived(selectedImages.size);

  // Get status for an individual image
  function getImageStatus(filename: string): ImageStatus | null {
    const hasDiffImg = diffsSet.has(filename);
    const hasBaselineImg = baselinesSet.has(filename);
    const hasTest = testsSet.has(filename);

    if (hasDiffImg) return 'failed';
    if (hasTest && !hasBaselineImg) return 'new';
    if (hasTest && hasBaselineImg) return 'passed';
    return null;
  }

  // Check if selected images are approvable (must have test images)
  let selectedApprovable = $derived.by(() => {
    return [...selectedImages].filter(f => testsSet.has(f));
  });

  // Check if selected images are rejectable (must be tests, not passed)
  let selectedRejectable = $derived.by(() => {
    return [...selectedImages].filter(f => {
      const status = getImageStatus(f);
      return status === 'failed' || status === 'new';
    });
  });

  /** Maps current tab to image type for API calls */
  let currentImageType = $derived<'baseline' | 'test' | 'diff'>(
    activeTab === 'baselines' ? 'baseline' : activeTab === 'tests' ? 'test' : 'diff'
  );

  let activeMetadata = $derived.by<ImageMetadata[]>(() => {
    switch (activeTab) {
      case 'baselines':
        return baselinesMetadata;
      case 'tests':
        return testsMetadata;
      case 'diffs':
        return diffsMetadata;
      default:
        return [];
    }
  });

  let metadataMap = $derived.by(() => new Map(activeMetadata.map((meta) => [meta.filename, meta])));
  let baselineMetadataMap = $derived.by(() => new Map(baselinesMetadata.map((meta) => [meta.filename, meta])));
  let testMetadataMap = $derived.by(() => new Map(testsMetadata.map((meta) => [meta.filename, meta])));
  let diffsMetadataMap = $derived.by(() => new Map(diffsMetadata.map((meta) => [meta.filename, meta])));
  let viewportMap = $derived.by(
    () => new Map((configData?.viewports ?? []).map((viewport) => [viewport.name, viewport]))
  );
  let scenarioThresholdMap = $derived.by(
    () =>
      new Map(
        (configData?.scenarios ?? []).map((scenario) => [
          scenario.name.trim(),
          scenario.diffThreshold ?? {},
        ])
      )
  );

  function hasDiffThreshold(threshold?: DiffThreshold | null): boolean {
    return !!threshold && (threshold.maxDiffPercentage !== undefined || threshold.maxDiffPixels !== undefined);
  }

  function resolveBaseDiffThreshold(meta?: ImageMetadata | null): DiffThreshold | null {
    if (!configData) return null;
    const scenario = meta?.scenario?.trim();
    const scenarioThreshold = scenario ? scenarioThresholdMap.get(scenario) : undefined;
    if (hasDiffThreshold(scenarioThreshold)) {
      return scenarioThreshold ?? null;
    }
    if (hasDiffThreshold(configData.diffThreshold)) {
      return configData.diffThreshold ?? null;
    }
    return null;
  }

  function buildAutoThresholdKey(scenario?: string, viewport?: string): string | null {
    const scenarioValue = scenario?.trim();
    const viewportValue = viewport?.trim();
    if (!scenarioValue || !viewportValue) return null;
    return `${scenarioValue}::${viewportValue}`;
  }

  let autoThresholdReviewItems = $derived.by<AutoThresholdReviewItem[]>(() => {
    if (!configData?.autoThresholds?.enabled) return [];
    if (!autoThresholdCaps) return [];

    const items: AutoThresholdReviewItem[] = [];

    for (const filename of diffs) {
      const meta = diffsMetadataMap.get(filename);
      if (!meta) continue;
      const metrics = imageResults[filename]?.metrics;
      if (!metrics || !Number.isFinite(metrics.diffPercentage)) continue;

      const baseThreshold = resolveBaseDiffThreshold(meta);
      if (!hasDiffThreshold(baseThreshold)) continue;

      const key = buildAutoThresholdKey(meta.scenario, meta.viewport);
      if (!key) continue;

      const cap = autoThresholdCaps.caps[key];
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

  let autoThresholdReviewSet = $derived.by(
    () => new Set(autoThresholdReviewItems.map((item) => item.filename))
  );
  let autoThresholdReviewCount = $derived(autoThresholdReviewItems.length);

  function getMetadataForCompareItem(
    item: { type: ImageType; filename: string } | null
  ): ImageMetadata | null {
    if (!item) return null;
    if (item.type === 'baseline') {
      return baselineMetadataMap.get(item.filename) ?? null;
    }
    if (item.type === 'test') {
      return testMetadataMap.get(item.filename) ?? null;
    }
    return null;
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

  // Smart queue for gallery: priority order is failed -> new -> passed
  type GalleryImage = {
    filename: string;
    status: ImageStatus;
    confidence?: { score: number; pass: boolean; verdict: 'pass' | 'warn' | 'fail' };
    metrics?: { pixelDiff: number; diffPercentage: number; ssimScore?: number };
  };
  let galleryQueue = $derived.by((): GalleryImage[] => {
    const failed: GalleryImage[] = [];
    const newImages: GalleryImage[] = [];
    const passed: GalleryImage[] = [];

    for (const filename of tests) {
      const status = getImageStatus(filename);
      const result = imageResults[filename];
      const item: GalleryImage = {
        filename,
        status: status || 'passed',
        confidence: result?.confidence,
        metrics: result?.metrics
      };

      if (status === 'failed') {
        failed.push(item);
      } else if (status === 'new') {
        newImages.push(item);
      } else if (status === 'passed') {
        passed.push(item);
      }
    }

    return [...failed, ...newImages, ...passed];
  });

  // Filtered gallery queue respects tagFilter and activeTab
  let filteredGalleryQueue = $derived.by((): GalleryImage[] => {
    if (activeTab === 'diffs') return galleryQueue.filter(item => item.status === 'failed');
    if (tagFilter.has('all')) return galleryQueue;
    return galleryQueue.filter(item => matchesTagSet(item.filename, tagFilter));
  });

  // Multi-select functions
  function toggleImageSelection(filename: string, index: number, event: MouseEvent) {
    const newSelected = new Set(selectedImages);

    if (event.shiftKey && lastSelectedIndex !== null) {
      const start = Math.min(lastSelectedIndex, index);
      const end = Math.max(lastSelectedIndex, index);
      for (let i = start; i <= end; i++) {
        newSelected.add(currentList[i]);
      }
    } else {
      if (newSelected.has(filename)) {
        newSelected.delete(filename);
      } else {
        newSelected.add(filename);
      }
    }

    selectedImages = newSelected;
    lastSelectedIndex = index;
  }

  // Smart select: first click selects current page, second click selects all filtered
  let allPageSelected = $derived(currentList.length > 0 && currentList.every((f) => selectedImages.has(f)));
  let allFilteredSelected = $derived(fullList.length > 0 && fullList.every((f) => selectedImages.has(f)));

  function selectAll() {
    if (allFilteredSelected) {
      // Already all selected, no-op
      return;
    }
    if (allPageSelected && totalPages > 1) {
      // Expand to all filtered pages
      selectedImages = new Set(fullList);
    } else {
      // Select current page
      selectedImages = new Set(currentList);
    }
  }

  let selectAllLabel = $derived.by(() => {
    if (allFilteredSelected) return `All (${fullList.length})`;
    if (allPageSelected && totalPages > 1) return `All Pages (${fullList.length})`;
    return 'Select All';
  });

  function deselectAll() {
    selectedImages = new Set();
    lastSelectedIndex = null;
  }

  function isSelected(filename: string): boolean {
    return selectedImages.has(filename);
  }

  function showToast(message: string, type: 'success' | 'error') {
    toastMessage = message;
    toastType = type;
    const timeout = type === 'error' ? 5000 : 3000;
    setTimeout(() => {
      toastMessage = null;
    }, timeout);
  }

  async function handleBulkApprove() {
    const filenames = selectedApprovable;
    if (filenames.length === 0) return;

    bulkOperating = true;
    bulkProgress = 0;
    bulkTotal = filenames.length;

    const originalBaselines = [...baselines];
    const originalTests = [...tests];
    const originalDiffs = [...diffs];

    baselines = [...new Set([...baselines, ...filenames])];

    try {
      const result = await images.bulkApprove(projectId, filenames);

      if (result.failed.length > 0) {
        await loadProject();
        showToast(`Approved ${result.approved.length}, failed ${result.failed.length}`, 'error');
      } else {
        showToast(`Approved ${result.approved.length} images`, 'success');
      }

      deselectAll();
    } catch (err) {
      baselines = originalBaselines;
      tests = originalTests;
      diffs = originalDiffs;
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

    const originalTests = [...tests];
    const originalDiffs = [...diffs];

    const filenameSet = new Set(filenames);
    tests = tests.filter(t => !filenameSet.has(t));
    diffs = diffs.filter(d => !filenameSet.has(d));

    try {
      const rejected: string[] = [];
      const failed: string[] = [];

      for (const filename of filenames) {
        try {
          await images.reject(projectId, filename);
          rejected.push(filename);
          bulkProgress = rejected.length + failed.length;
        } catch (err) {
          console.error(`Failed to reject ${filename}:`, err);
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
    } catch (err) {
      tests = originalTests;
      diffs = originalDiffs;
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

    const originalBaselines = [...baselines];
    const originalTests = [...tests];
    const originalDiffs = [...diffs];

    const filenameSet = new Set(filenames);
    if (activeTab === 'baselines') {
      baselines = baselines.filter((b) => !filenameSet.has(b));
    } else {
      tests = tests.filter((t) => !filenameSet.has(t));
      diffs = diffs.filter((d) => !filenameSet.has(d));
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
          console.error(`Failed to delete ${filename}:`, err);
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
    } catch (err) {
      baselines = originalBaselines;
      tests = originalTests;
      diffs = originalDiffs;
      showToast(getErrorMessage(err, 'Bulk delete failed'), 'error');
    } finally {
      bulkOperating = false;
    }
  }

  // Image operations
  function onImageLoad(filename: string) {
    loadedImages.add(filename);
    loadedImages = new Set(loadedImages);
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

  // Gallery functions
  function openGallery(filename: string) {
    const index = filteredGalleryQueue.findIndex((item) => item.filename === filename);
    galleryStartIndex = index >= 0 ? index : 0;
    showGallery = true;
  }

  function closeGallery() {
    showGallery = false;
  }

  function handleGalleryApprove(filename: string) {
    const originalBaselines = [...baselines];
    const originalDiffs = [...diffs];

    baselines = [...new Set([...baselines, filename])];
    diffs = diffs.filter((d) => d !== filename);

    images.approve(projectId, filename).catch((err) => {
      baselines = originalBaselines;
      diffs = originalDiffs;
      showToast(getErrorMessage(err, 'Approve failed'), 'error');
    });
  }

  function handleGalleryReject(filename: string) {
    const originalTests = [...tests];
    const originalDiffs = [...diffs];

    tests = tests.filter((t) => t !== filename);
    diffs = diffs.filter((d) => d !== filename);

    images.reject(projectId, filename).catch((err) => {
      tests = originalTests;
      diffs = originalDiffs;
      showToast(getErrorMessage(err, 'Reject failed'), 'error');
    });
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
      const viewportInfo = viewport ? viewportMap.get(viewport) : undefined;

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

  async function handleAnalyze(filenames: string[]) {
    if (!compareLeft || !compareRight) {
      error = 'Select images to compare before analyzing';
      return;
    }

    try {
      analyzing = true;
      const items = filenames.map((filename) => ({
        baseline: { type: compareLeft!.type, filename: compareLeft!.filename },
        test: { type: compareRight!.type, filename },
        diff: compareResult?.diffFilename
          ? { type: 'custom-diff' as const, filename: compareResult.diffFilename }
          : undefined,
        name: filename,
      }));

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

  function closeAnalysisModal() {
    showAnalysisModal = false;
    analysisResults = [];
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
      phash: compareResult.phash,
    };
    compareMode = 'manual';
    compareFullscreenTitle = `${compareLeft.filename} vs ${compareRight.filename}`;
    showCompareFullscreen = true;
  }

  function buildCrossComparePayload(item: CrossResultItem) {
    if (!crossResults) return null;
    const baselineLabel = crossResults.baselineLabel || 'Baseline';
    const testLabel = crossResults.testLabel || 'Test';
    return {
      images: {
        left: {
          src: getFileUrl(item.baseline),
          label: baselineLabel,
        },
        right: {
          src: getFileUrl(item.test),
          label: testLabel,
        },
        diff: item.diff
          ? {
              src: getFileUrl(item.diff),
              label: 'Diff',
            }
          : undefined,
      },
      metrics: {
        pixelDiff: item.pixelDiff,
        diffPercentage: item.diffPercentage,
        ssimScore: item.ssimScore,
        phash: item.phash,
      },
      title: `${item.scenario} · ${item.viewport}`,
    };
  }

  function setCrossCompareItem(item: CrossResultItem) {
    const payload = buildCrossComparePayload(item);
    if (!payload) return;
    compareImages = payload.images;
    compareMetrics = payload.metrics;
    compareFullscreenTitle = payload.title;
    currentCrossItem = item;
  }

  function setCrossCompareIndex(index: number) {
    if (crossFilteredItems.length === 0) return;
    const bounded = Math.max(0, Math.min(crossFilteredItems.length - 1, index));
    crossQueueIndex = bounded;
    const item = crossFilteredItems[bounded];
    if (item) {
      setCrossCompareItem(item);
    }
  }

  function openCrossCompare(item: CrossResultItem) {
    const index = crossFilteredItems.findIndex((entry) => entry.itemKey === item.itemKey);
    setCrossCompareIndex(index === -1 ? 0 : index);
    compareMode = 'cross';
    showCompareFullscreen = true;
  }

  function closeCompareFullscreen() {
    showCompareFullscreen = false;
    compareImages = null;
    compareMetrics = null;
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
    lastSelectedIndex = null;
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
        Baselines ({baselines.length})
      </button>
      <button
        class="tab"
        class:active={activeTab === 'tests' && tagFilter.has('all')}
        onclick={() => { activeTab = 'tests'; setTagFilter('all'); }}
      >
        Tests ({tests.length})
      </button>
      <button
        class="tab"
        class:active={activeTab === 'diffs'}
        onclick={() => { activeTab = 'diffs'; setTagFilter('diff'); }}
      >
        Diffs ({diffs.length})
      </button>
      <button
        class="tab"
        class:active={activeTab === 'compare'}
        onclick={() => { activeTab = 'compare'; setTagFilter('all'); }}
      >
        Compare Tool
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
            baselines={baselinesMetadata}
            tests={testsMetadata}
            diffs={diffsMetadata}
            onCompare={handleCustomCompare}
            {comparing}
          />

          {#if compareResult && compareLeft && compareRight}
            <div class="compare-results">
              <div class="threshold-control">
                <label class="threshold-label">
                  <span>Threshold:</span>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.01"
                    bind:value={threshold}
                    class="threshold-slider"
                  />
                  <input
                    type="number"
                    min="0"
                    max="1"
                    step="0.01"
                    bind:value={threshold}
                    class="threshold-input"
                  />
                </label>
                <button
                  class="btn small"
                  onclick={recompareWithThreshold}
                  disabled={comparing}
                >
                  {comparing ? 'Comparing...' : 'Re-compare'}
                </button>
              </div>
              <div class="compare-stats">
                <div class="stat">
                  <span class="stat-label">Pixel Diff</span>
                  <span class="stat-value">{compareResult.pixelDiff.toLocaleString()}</span>
                </div>
                <div class="stat">
                  <span class="stat-label">Diff %</span>
                  <span class="stat-value">{compareResult.diffPercentage.toFixed(2)}%</span>
                </div>
                {#if compareResult.ssimScore !== undefined}
                  <div class="stat">
                    <span class="stat-label">SSIM</span>
                    <span class="stat-value">{(compareResult.ssimScore * 100).toFixed(1)}%</span>
                  </div>
                {/if}
                {#if compareResult.phash}
                  <div class="stat">
                    <span class="stat-label">pHash</span>
                    <span class="stat-value">{(compareResult.phash.similarity * 100).toFixed(1)}%</span>
                  </div>
                {/if}
              </div>

              <div class="compare-images">
                <button
                  class="compare-image-card clickable"
                  onclick={openFullscreenCompare}
                  title="Click to view fullscreen"
                >
                  <img
                    src={getImageUrl(compareLeft.type, compareLeft.filename)}
                    alt="Left"
                  />
                </button>
                <button
                  class="compare-image-card clickable"
                  onclick={openFullscreenCompare}
                  title="Click to view fullscreen"
                >
                  <img
                    src={getImageUrl(compareRight.type, compareRight.filename)}
                    alt="Right"
                  />
                </button>
                <button
                  class="compare-image-card clickable"
                  onclick={openFullscreenCompare}
                  title="Click to view fullscreen"
                >
                  <img
                    src={compareResult.diffUrl}
                    alt="Diff"
                  />
                </button>
              </div>

            </div>
          {:else if !comparing}
            <div class="compare-hint">
              Select two images above to compare them
            </div>
          {/if}
        </div>
      {:else if activeTab === 'cross'}
        <div class="cross-content">
          <div class="cross-toolbar">
            <div class="cross-select">
              <label for="cross-pair-select">Pair</label>
              <select id="cross-pair-select" onchange={handleCrossPairChange} bind:value={selectedCrossKey}>
                <option value="" disabled selected={!selectedCrossKey}>Select a cross compare pair</option>
                {#each filteredCrossReports as report}
                  <option value={report.key}>{report.title} · {formatCrossPairSummary(report)}</option>
                {/each}
              </select>
            </div>
            <button class="btn" onclick={runCrossCompare} disabled={crossCompareRunning}>
              {crossCompareRunning ? 'Cross Comparing...' : 'Run All Pairs'}
            </button>
            <button class="btn" onclick={runSelectedCrossPair} disabled={!selectedCrossKey || crossCompareRunning}>
              {crossCompareRunning ? 'Cross Comparing...' : 'Run Pair'}
            </button>
            <button class="btn danger" onclick={clearCrossPair} disabled={!selectedCrossKey || crossCompareRunning}>
              Delete Pair
            </button>
          </div>

          {#if crossReports.length > 0}
            <div class="cross-pair-filters">
              <span class="pair-filter-label">Pair Filters</span>
              <div class="tag-filters">
              <button
                class="tag-filter tag-all"
                class:active={crossPairFilter === 'all'}
                onclick={() => crossPairFilter = 'all'}
                title="Show all cross-compare pairs"
              >
                All ({crossPairCounts.all})
              </button>
              <button
                class="tag-filter tag-diff"
                class:active={crossPairFilter === 'diffs'}
                onclick={() => crossPairFilter = 'diffs'}
                title="Pairs with at least one diff"
              >
                Diffs ({crossPairCounts.diffs})
              </button>
              <button
                class="tag-filter tag-unapproved"
                class:active={crossPairFilter === 'issues'}
                onclick={() => crossPairFilter = 'issues'}
                title="Pairs with issues (errors, missing images)"
              >
                Issues ({crossPairCounts.issues})
              </button>
              <button
                class="tag-filter tag-smart"
                class:active={crossPairFilter === 'smart'}
                onclick={() => crossPairFilter = 'smart'}
                title="Pairs with smart-pass items"
              >
                Smart Pass ({crossPairCounts.smart})
              </button>
              <button
                class="tag-filter tag-approved"
                class:active={crossPairFilter === 'approved'}
                onclick={() => crossPairFilter = 'approved'}
                title="Pairs with approved items"
              >
                Approved ({crossPairCounts.approved})
              </button>
              <button
                class="tag-filter tag-passed"
                class:active={crossPairFilter === 'matches'}
                onclick={() => crossPairFilter = 'matches'}
                title="Pairs with matches (including smart pass)"
              >
                Matches ({crossPairCounts.matches})
              </button>
            </div>
            </div>
          {/if}

          <div class="search-bar cross-search-bar">
            <input
              type="text"
              class="search-input"
              placeholder="Filter by scenario or viewport..."
              bind:value={crossSearchQuery}
            />
            {#if crossSearchQuery}
              <button class="clear-btn" onclick={() => crossSearchQuery = ''}>x</button>
            {/if}
            <span class="result-count">
              {crossFilteredItems.length} of {crossResults?.items.length || 0} items
            </span>
            <div class="tag-filters" title="Cmd/Ctrl-click to multi-select">
              <button
                class="tag-filter tag-all"
                class:active={isCrossStatusActive('all')}
                onclick={(event) => toggleCrossStatusFilter('all', event)}
                title="Show all items regardless of status"
              >
                All
              </button>
              <button
                class="tag-filter tag-diff"
                class:active={isCrossStatusActive('diffs')}
                onclick={(event) => toggleCrossStatusFilter('diffs', event)}
                title="Items with visual diffs"
              >
                Diffs
              </button>
              <button
                class="tag-filter tag-passed"
                class:active={isCrossStatusActive('matches')}
                onclick={(event) => toggleCrossStatusFilter('matches', event)}
                title="Items that match"
              >
                Matches
              </button>
              <button
                class="tag-filter tag-smart"
                class:active={isCrossStatusActive('smart')}
                onclick={(event) => toggleCrossStatusFilter('smart', event)}
                title="Matches with non-zero diffs (smart pass)"
              >
                Smart Pass
              </button>
              <button
                class="tag-filter tag-approved"
                class:active={isCrossStatusActive('approved')}
                onclick={(event) => toggleCrossStatusFilter('approved', event)}
                title="Items you have approved"
              >
                Approved
              </button>
              <button
                class="tag-filter tag-unapproved"
                class:active={isCrossStatusActive('unapproved')}
                onclick={(event) => toggleCrossStatusFilter('unapproved', event)}
                title="Items not yet approved"
              >
                Unapproved
              </button>
              <button
                class="tag-filter"
                class:active={crossHideApproved}
                onclick={() => crossHideApproved = !crossHideApproved}
                title="Hide approved items from results"
              >
                Hide Approved
              </button>
            </div>
            <div class="cross-selection-controls">
              {#if selectedCrossCount > 0}
                <span class="selected-count">{selectedCrossCount} selected</span>
                <button class="btn small rerun" onclick={rerunSelectedCrossItems} disabled={crossCompareRunning}>
                  {crossCompareRunning ? 'Running...' : `Rerun (${selectedCrossCount})`}
                </button>
              {/if}
              <button
                class="btn small"
                class:expanded={allCrossPageSelected && !allCrossFilteredSelected && crossTotalPages > 1}
                class:all-selected={allCrossFilteredSelected}
                onclick={selectAllCross}
                disabled={crossFilteredItems.length === 0 || allCrossFilteredSelected}
              >
                {selectAllCrossLabel}
              </button>
              <button class="btn small" onclick={deselectAllCross} disabled={selectedCrossCount === 0}>
                Deselect
              </button>
              <button class="btn small danger" onclick={deleteCrossItems} disabled={selectedCrossCount === 0}>
                Delete Selected
              </button>
              <button
                class="btn small rerun"
                onclick={rerunFilteredCrossItems}
                disabled={crossFilteredItems.length === 0 || crossCompareRunning}
              >
                {crossCompareRunning ? 'Running...' : `Rerun Filtered (${crossFilteredItems.length})`}
              </button>
            </div>
          </div>

          {#if crossCompareError}
            <div class="error">{crossCompareError}</div>
          {/if}
          {#if crossResultsError}
            <div class="error">{crossResultsError}</div>
          {/if}

          {#if crossResultsLoading}
            <div class="compare-hint">Loading cross compare results...</div>
          {:else if crossReports.length > 0 && filteredCrossReports.length === 0}
            <div class="compare-hint">No cross-compare pairs match your filter.</div>
          {:else if crossResults}
            <div class="cross-summary-line">
              {#if crossPairSummary}
                Pair: {crossResults.baselineLabel} vs {crossResults.testLabel}
                · Generated: {new Date(crossResults.generatedAt).toLocaleString()}
                · Items: {crossPairSummary.total}
                · Approved: {crossPairSummary.approved}
                · Smart Pass: {crossPairSummary.smart}
                · Match: {crossPairSummary.match}
                · Diff: {crossPairSummary.diff}
                · Issue: {crossPairSummary.issue}
              {:else}
                Pair: {crossResults.baselineLabel} vs {crossResults.testLabel}
                · Generated: {new Date(crossResults.generatedAt).toLocaleString()}
                · Items: {crossFilteredItems.length}
              {/if}
            </div>

            {#if crossFilteredItems.length === 0}
              <div class="compare-hint">No cross-compare items match your filter.</div>
            {:else}
              {#if crossTotalPages > 1}
                <div class="pagination">
                  <button
                    class="btn small"
                    onclick={() => crossCurrentPage = Math.max(0, crossCurrentPage - 1)}
                    disabled={crossCurrentPage === 0}
                  >
                    Prev
                  </button>
                  <span class="page-info">
                    Page {crossCurrentPage + 1} of {crossTotalPages} ({crossFilteredItems.length} items)
                  </span>
                  <button
                    class="btn small"
                    onclick={() => crossCurrentPage = Math.min(crossTotalPages - 1, crossCurrentPage + 1)}
                    disabled={crossCurrentPage >= crossTotalPages - 1}
                  >
                    Next
                  </button>
                </div>
              {/if}
              <div class="cross-grid">
                {#each crossCurrentList as item}
                  {@const smartPass = item.match && item.diffPercentage > 0}
                  {@const crossTag = item.accepted ? 'approved' : item.match ? smartPass ? 'smart' : 'passed' : item.reason === 'diff' ? 'diff' : 'unapproved'}
                  <div class="cross-card tag-{crossTag}">
                    <div class="cross-card-header">
                      <label class="cross-select-box">
                        <input
                          type="checkbox"
                          checked={selectedCrossItems.has(item.itemKey ?? `${item.scenario}__${item.viewport}`)}
                          onchange={() => toggleCrossSelected(item)}
                        />
                      </label>
                      <div>
                        <div class="cross-title">{item.scenario}</div>
                        <div class="cross-meta">{item.viewport}</div>
                      </div>
                      <div class="cross-badge tag-{crossTag}">
                        {item.accepted ? 'Approved' : item.match ? smartPass ? 'Smart Pass' : 'Match' : item.reason === 'diff' ? 'Diff' : 'Issue'}
                      </div>
                    </div>
                    <div class="cross-stats">
                      <span>{item.diffPercentage.toFixed(2)}%</span>
                      <span>{item.pixelDiff.toLocaleString()} px</span>
                      {#if item.ssimScore !== undefined}
                        <span>SSIM {(item.ssimScore * 100).toFixed(1)}%</span>
                      {/if}
                    </div>
                    <div class="cross-images">
                      <button class="cross-image" onclick={() => openCrossCompare(item)} title="Open fullscreen compare">
                        <img
                          src={getFileUrl(item.baseline)}
                          alt="Baseline"
                          loading="lazy"
                          decoding="async"
                          fetchpriority="low"
                        />
                      </button>
                      {#if item.diff}
                        <button class="cross-image" onclick={() => openCrossCompare(item)} title="Open fullscreen compare">
                          <img
                            src={getFileUrl(item.diff)}
                            alt="Diff"
                            loading="lazy"
                            decoding="async"
                            fetchpriority="low"
                          />
                        </button>
                      {/if}
                      <button class="cross-image" onclick={() => openCrossCompare(item)} title="Open fullscreen compare">
                        <img
                          src={getFileUrl(item.test)}
                          alt="Test"
                          loading="lazy"
                          decoding="async"
                          fetchpriority="low"
                        />
                      </button>
                    </div>
                    <div class="cross-actions">
                      {#if item.accepted}
                        <button class="btn small ghost" onclick={() => revokeCrossItem(item)}>
                          Approved · Undo
                        </button>
                      {:else}
                        <button class="btn small" onclick={() => approveCrossItem(item)}>
                          Approve Diff
                        </button>
                      {/if}
                      <button class="btn small danger" onclick={() => deleteCrossItem(item)}>
                        Delete
                      </button>
                    </div>
                  </div>
                {/each}
              </div>
            {/if}
          {:else}
            <div class="compare-hint">
              Run cross compare to generate results for browser pairs.
            </div>
          {/if}
        </div>
      {:else}
        <div class="image-panel">
          <!-- Search filter and selection controls -->
          <div class="search-bar">
            <input
              type="text"
              class="search-input"
              placeholder="Filter images..."
              bind:value={searchQuery}
            />
            {#if searchQuery}
              <button class="clear-btn" onclick={() => searchQuery = ''}>x</button>
            {/if}
            <span class="result-count">
              {fullList.length} of {rawList.length} images
            </span>
            <div class="tag-filters" title="Cmd/Ctrl-click to multi-select">
              <button
                class="tag-filter tag-all"
                class:active={isTagActive('all')}
                onclick={(event) => toggleTagFilter('all', event)}
                title="Show all images"
              >
                All
              </button>
              <button
                class="tag-filter tag-passed"
                class:active={isTagActive('passed')}
                onclick={(event) => toggleTagFilter('passed', event)}
                title="Baseline matches test"
              >
                Passed
              </button>
              <button
                class="tag-filter tag-new"
                class:active={isTagActive('new')}
                onclick={(event) => toggleTagFilter('new', event)}
                title="Test exists without baseline"
              >
                New
              </button>
              <button
                class="tag-filter tag-unapproved"
                class:active={isTagActive('unapproved')}
                onclick={(event) => toggleTagFilter('unapproved', event)}
                title="Diffs or new items not approved"
              >
                Unapproved
              </button>
              <button
                class="tag-filter tag-approved"
                class:active={isTagActive('approved')}
                onclick={(event) => toggleTagFilter('approved', event)}
                title="Items you have approved"
              >
                Approved
              </button>
              <button
                class="tag-filter tag-diff"
                class:active={isTagActive('diff')}
                onclick={(event) => toggleTagFilter('diff', event)}
                title="Images with visual diffs"
              >
                Diff
              </button>
              {#if activeTab === 'diffs' && autoThresholdReviewCount > 0}
                <button
                  class="tag-filter tag-auto-review"
                  class:active={isTagActive('auto-review')}
                  onclick={(event) => toggleTagFilter('auto-review', event)}
                  title="Diffs requiring auto-threshold review"
                >
                  Auto Review ({autoThresholdReviewCount})
                </button>
              {/if}
            </div>
            <div class="selection-controls">
              <button class="btn small" class:expanded={allPageSelected && !allFilteredSelected && totalPages > 1} class:all-selected={allFilteredSelected} onclick={selectAll}>{selectAllLabel}</button>
              <button class="btn small" onclick={deselectAll} disabled={selectedCount === 0}>Deselect</button>
              {#if selectedCount > 0}
                <span class="selected-count">{selectedCount} selected</span>
                <button class="btn small rerun" onclick={handleBulkRerun} disabled={!!testState}>
                  {testState ? 'Running...' : `Rerun (${selectedCount})`}
                </button>
              {/if}
            </div>
          </div>

          {#if fullList.length === 0}
            <div class="empty">
              {#if debouncedSearchQuery}
                No images match "{debouncedSearchQuery}"
              {:else}
                No images in this folder
              {/if}
            </div>
          {:else}
            <!-- Pagination header -->
            {#if totalPages > 1}
              <div class="pagination">
                <button
                  class="btn small"
                  onclick={() => currentPage = Math.max(0, currentPage - 1)}
                  disabled={currentPage === 0}
                >
                  Prev
                </button>
                <span class="page-info">
                  Page {currentPage + 1} of {totalPages} ({fullList.length} images)
                </span>
                <button
                  class="btn small"
                  onclick={() => currentPage = Math.min(totalPages - 1, currentPage + 1)}
                  disabled={currentPage >= totalPages - 1}
                >
                  Next
                </button>
              </div>
            {:else}
              <div class="image-count">{fullList.length} images</div>
            {/if}

            <div class="image-grid">
              {#each currentList as filename, index (filename)}
                {@const status = getImageStatus(filename)}
                {@const checked = isSelected(filename)}
                {@const meta = metadataMap.get(filename)}
                {@const tag = getTagFor(filename)}
                <div
                  class="image-card"
                  class:multi-selected={checked}
                  class:tag-approved={tag === 'approved'}
                  class:tag-unapproved={tag === 'unapproved'}
                  class:tag-new={tag === 'new'}
                  class:tag-passed={tag === 'passed'}
                  class:tag-diff={tag === 'diff'}
                  class:tag-auto-review={tag === 'auto-review'}
                  onclick={() => openGallery(filename)}
                  onkeydown={(e) => e.key === 'Enter' && openGallery(filename)}
                  role="button"
                  tabindex="0"
                >
                  <div class="image-card-header">
                    <div class="image-card-title">
                      <div class="image-title" title={meta?.scenario || filename}>
                        {meta?.scenario || filename}
                      </div>
                      <div class="image-meta">
                        {#if meta}
                          {meta.browser}{meta.version ? ` v${meta.version}` : ''} · {meta.viewport}
                        {:else}
                          {currentImageType}
                        {/if}
                      </div>
                    </div>
                    <div class="image-tag tag-{tag}">
                      {getTagLabel(tag)}
                    </div>
                  </div>
                  <div class="image-thumb">
                    <label
                      class="checkbox-wrapper"
                      class:visible={checked}
                      onclick={(e) => e.stopPropagation()}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onclick={(e) => toggleImageSelection(filename, index, e)}
                      />
                      <span class="checkmark"></span>
                    </label>
                    {#if !loadedImages.has(filename)}
                      <div class="image-placeholder"></div>
                    {/if}
                    <img
                      src={getImageUrl(currentImageType, filename)}
                      alt={filename}
                      loading="lazy"
                      onload={() => onImageLoad(filename)}
                      class:loaded={loadedImages.has(filename)}
                    />
                  </div>
                  <div class="image-name" title={filename}>{filename}</div>
                </div>
              {/each}
            </div>
          {/if}
        </div>
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
    onAccept={handleAcceptForBrowser}
  />
{/if}

<!-- Fullscreen Compare Modal -->
{#if showCompareFullscreen && compareImages && compareMetrics}
  <FullscreenGallery
    compareImages={compareImages}
    compareTitle={compareFullscreenTitle}
    compareMetrics={compareMetrics}
    compareViewport={compareViewport ?? undefined}
    compareQueue={compareMode === 'cross' ? crossCompareQueue : []}
    compareIndex={compareMode === 'cross' ? crossQueueIndex : 0}
    onCompareNavigate={compareMode === 'cross' ? setCrossCompareIndex : undefined}
    compareThreshold={compareMode === 'manual' ? threshold : undefined}
    onThresholdChange={compareMode === 'manual' ? (t) => (threshold = t) : undefined}
    onRecompare={compareMode === 'manual' ? recompareWithThreshold : undefined}
    onAnalyze={compareMode === 'manual' ? () => compareRight && handleAnalyze([compareRight.filename]) : undefined}
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
        ? !!acceptances[compareRight.filename]
        : compareMode === 'cross'
          ? !!currentCrossItem?.accepted
          : false
    }
    analyzing={compareMode === 'manual' ? analyzing : false}
    recomparing={compareMode === 'manual' ? comparing : false}
    onClose={closeCompareFullscreen}
  />
{/if}

<!-- Bulk Action Bar -->
{#if selectedCount > 0 && activeTab !== 'compare' && activeTab !== 'cross'}
  <div class="bulk-action-bar" class:operating={bulkOperating}>
    <div class="bulk-info">
      <span class="bulk-count">{selectedCount} selected</span>
      {#if bulkOperating}
        <span class="bulk-progress">Processing {bulkProgress}/{bulkTotal}...</span>
      {/if}
    </div>
    <div class="bulk-actions">
      {#if selectedApprovable.length > 0}
        <button
          class="btn primary"
          onclick={handleBulkApprove}
          disabled={bulkOperating}
        >
          Approve All ({selectedApprovable.length})
        </button>
      {/if}
      {#if selectedRejectable.length > 0}
        <button
          class="btn danger"
          onclick={handleBulkReject}
          disabled={bulkOperating}
        >
          Reject All ({selectedRejectable.length})
        </button>
      {/if}
      <button class="btn danger" onclick={handleBulkDelete} disabled={bulkOperating}>
        Delete Selected
      </button>
      <button class="btn" onclick={deselectAll} disabled={bulkOperating}>
        Cancel
      </button>
    </div>
  </div>
{/if}

<!-- Toast Notification -->
{#if toastMessage}
  <div class="toast" class:success={toastType === 'success'} class:error={toastType === 'error'}>
    {toastMessage}
  </div>
{/if}

<!-- Fullscreen Gallery -->
{#if showGallery && filteredGalleryQueue.length > 0}
  <FullscreenGallery
    queue={filteredGalleryQueue}
    initialIndex={galleryStartIndex}
    {baselines}
    {diffs}
    onClose={closeGallery}
    onApprove={handleGalleryApprove}
    onReject={handleGalleryReject}
    onRerun={handleRerun}
    testRunning={!!testState}
    {getImageUrl}
  />
{/if}

<style>
  .project-page {
    max-width: 1400px;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    min-height: calc(100vh - 100px);
    --tag-approved: #22c55e;
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
    border: none;
    border-radius: 6px;
    background: var(--border);
    color: var(--text-strong);
    font-size: 0.875rem;
    cursor: pointer;
    transition: background 0.2s;
  }

  .btn:hover {
    background: var(--border-soft);
  }

  .btn.primary {
    background: var(--accent);
    color: #fff;
  }

  .btn.primary:hover {
    background: var(--accent-strong);
  }

  .btn.warning {
    background: #f59e0b;
    color: #fff;
  }

  .btn.warning:hover {
    background: #d97706;
  }

  .btn.danger {
    background: #7f1d1d;
    color: #fff;
  }

  .btn.danger:hover {
    background: #ef4444;
  }

  .btn.small {
    padding: 0.375rem 0.75rem;
    font-size: 0.8rem;
  }

  .btn.active {
    background: var(--accent);
    color: #fff;
  }

  .btn.ghost {
    background: transparent;
    border: 1px solid var(--border);
    color: var(--text-muted);
  }

  .btn.ghost:hover:not(:disabled) {
    border-color: var(--accent);
    color: var(--text-strong);
  }

  .error {
    background: #7f1d1d;
    border: 1px solid #ef4444;
    padding: 0.75rem 1rem;
    border-radius: 6px;
    margin-bottom: 1rem;
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
    font-family: monospace;
    font-size: 0.85rem;
    white-space: pre-wrap;
    color: #fca5a5;
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
    border-radius: 8px;
    padding: 0.65rem 0.9rem;
    text-align: center;
    font: inherit;
    color: inherit;
  }

  .status-card.clickable {
    cursor: pointer;
    transition: border-color 0.2s, transform 0.2s;
  }

  .status-card.clickable:hover {
    border-color: var(--text-muted);
    transform: translateY(-2px);
  }

  .status-card.clickable.active {
    border-color: var(--accent);
    background: var(--panel-strong);
  }

  .status-value {
    font-size: 1.35rem;
    font-weight: 600;
    margin-bottom: 0.25rem;
  }

  .status-label {
    font-size: 0.75rem;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
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
    gap: 0.25rem;
    margin-bottom: 1rem;
  }

  .tab {
    padding: 0.5rem 1rem;
    background: var(--panel);
    border: 1px solid var(--border);
    border-bottom: none;
    border-radius: 6px 6px 0 0;
    color: var(--text-muted);
    font-size: 0.875rem;
    cursor: pointer;
    transition: all 0.2s;
  }

  .tab:hover {
    color: var(--text-strong);
  }

  .tab.active {
    background: var(--border);
    color: var(--text-strong);
    border-color: var(--accent);
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
    border-radius: 8px;
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
    border-radius: 6px;
    color: var(--text-strong);
    font-size: 0.875rem;
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
    padding: 0.28rem 0.6rem;
    border-radius: 999px;
    border: 1px solid transparent;
    background: var(--panel-strong);
    color: var(--text-muted);
    font-size: 0.65rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
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
    border: 2px solid var(--border-soft);
    border-radius: 12px;
    padding: 0.6rem;
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    cursor: pointer;
    transition: border-color 0.15s, transform 0.15s, box-shadow 0.15s;
    contain: layout style;
  }

  .image-card:hover {
    border-color: var(--text-muted);
    transform: translateY(-2px);
  }

  .image-card.multi-selected {
    border-color: var(--accent);
    box-shadow: 0 0 0 2px rgba(99, 102, 241, 0.15);
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
    font-size: 0.6rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    padding: 0.18rem 0.5rem;
    border-radius: 999px;
    border: 1px solid var(--border);
    background: var(--panel-strong);
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
    border-radius: 8px;
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
    border-radius: 4px;
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
    border-radius: 8px;
  }

  .compare-results {
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 8px;
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
    border-radius: 8px;
    color: var(--text);
    font-size: 0.9rem;
  }

  .cross-search-bar {
    border-radius: 8px;
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
    font-size: 0.75rem;
    color: var(--text-muted);
    padding: 0.45rem 0.65rem;
    border-radius: 8px;
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
    border: 2px solid var(--border-soft);
    border-radius: 12px;
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
    border-radius: 8px;
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
    font-size: 0.7rem;
    font-weight: 600;
    padding: 0.2rem 0.5rem;
    border-radius: 999px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    border: 1px solid var(--border);
    background: var(--panel-strong);
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
    border-radius: 8px;
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
    border-radius: 4px;
    color: var(--text);
    font-size: 0.875rem;
    text-align: center;
  }

  .threshold-input:focus {
    outline: none;
    border-color: var(--accent);
  }

  .threshold-slider {
    flex: 1;
    height: 6px;
    -webkit-appearance: none;
    appearance: none;
    background: var(--border);
    border-radius: 3px;
    outline: none;
    cursor: pointer;
  }

  .threshold-slider::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: var(--accent);
    cursor: pointer;
    transition: background 0.15s;
  }

  .threshold-slider::-webkit-slider-thumb:hover {
    background: var(--accent-strong);
  }

  .threshold-slider::-moz-range-thumb {
    width: 16px;
    height: 16px;
    border-radius: 50%;
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
    font-size: 0.75rem;
    color: var(--text-muted);
    text-transform: uppercase;
  }

  .stat-value {
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
    border-radius: 6px;
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
    border-radius: 8px;
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
    font-size: 1.25rem;
    font-weight: 600;
    color: var(--text);
  }

  .config-label {
    font-size: 0.7rem;
    color: var(--text-muted);
    text-transform: uppercase;
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
    font-size: 0.65rem;
    padding: 0.2rem 0.4rem;
    border-radius: 3px;
    text-transform: uppercase;
    font-weight: 600;
    color: var(--text-strong);
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
    background: #252525;
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
    border-radius: 8px;
    font-size: 0.875rem;
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

    .selection-controls {
      display: none;
    }
  }
</style>
