<script lang="ts">
  import {
    crossCompare,
    test,
    type CrossResultItem,
    type CrossResults,
    type CrossResultsSummary,
    type CrossReport,
    type AIAnalysisResult,
  } from '../lib/api';
  import { getErrorMessage } from '../lib/errors';
  import { CROSS_PAGE_SIZE } from '../../../shared/constants';

  type CrossStatusFilter =
    | 'all'
    | 'diffs'
    | 'matches'
    | 'smart'
    | 'approved'
    | 'unapproved'
    | 'flagged'
    | 'outdated'
    | 'ai-approved'
    | 'ai-review'
    | 'ai-rejected';

  type CrossPrefs = {
    searchQuery?: string;
    statusFilter?: CrossStatusFilter[];
    hideApproved?: boolean;
    selectedKey?: string | null;
  };
  const CROSS_STATUS_VALUES: CrossStatusFilter[] = [
    'all',
    'diffs',
    'matches',
    'smart',
    'approved',
    'unapproved',
    'flagged',
    'outdated',
    'ai-approved',
    'ai-review',
    'ai-rejected',
  ];
  let {
    projectId,
    crossReports = $bindable(),
    getFileUrl,
    getFileThumbUrl,
    onOpenCrossCompare,
    onOpenAIAnalysis,
    onSetActiveTab,
  } = $props<{
    projectId: string;
    crossReports: CrossResultsSummary[];
    getFileUrl: (relativePath: string) => string;
    getFileThumbUrl: (relativePath: string) => string;
    onOpenCrossCompare: (item: CrossResultItem, index: number, filteredItems: CrossResultItem[], results: CrossResults) => void;
    onOpenAIAnalysis?: (item: CrossResultItem) => void;
    onSetActiveTab: (tab: string) => void;
  }>();

  // Cross-compare state
  let crossCompareRunning = $state(false);
  let crossRunProgress = $state(0);
  let crossRunProgressLabel = $state('');
  let crossCompareError = $state<string | null>(null);
  let crossResults = $state<CrossResults | null>(null);
  let crossResultsLoading = $state(false);
  let crossResultsError = $state<string | null>(null);
  let crossTestRunning = $state(false);
  let crossTestError = $state<string | null>(null);
  let crossTestJob = $state<{ id: string; progress: number; total: number } | null>(null);
  let selectedCrossKey = $state<string | null>(null);
  let crossSearchQuery = $state('');
  let crossStatusFilter = $state<Set<CrossStatusFilter>>(new Set(['all']));
  let crossHideApproved = $state(false);
  let crossCurrentPage = $state(0);
  let crossPrefsLoaded = $state(false);
  let crossPrefsApplying = $state(false);
  let selectedCrossItems = $state<Set<string>>(new Set());
  let crossApproveRunning = $state(false);
  let crossApproveProgress = $state(0);
  let crossApproveTotal = $state(0);

  let aiTriageRunning = $state(false);
  let aiTriageError = $state<string | null>(null);

  type ViewMode = 'grid' | 'list';
  const CROSS_VIEW_KEY = 'vrt-cross-view-mode';
  let crossViewMode = $state<ViewMode>((localStorage.getItem(CROSS_VIEW_KEY) as ViewMode) || 'grid');
  function setCrossViewMode(mode: ViewMode) {
    crossViewMode = mode;
    localStorage.setItem(CROSS_VIEW_KEY, mode);
  }
  function getDiffColor(pct: number): string {
    if (pct < 1) return '#22c55e';
    if (pct <= 5) return '#f59e0b';
    return '#ef4444';
  }

  type SortMode = 'name' | 'diff';
  const CROSS_SORT_KEY = 'vrt-cross-sort-mode';
  let crossSortMode = $state<SortMode>((localStorage.getItem(CROSS_SORT_KEY) as SortMode) || 'name');
  function setCrossSortMode(mode: SortMode) {
    crossSortMode = mode;
    localStorage.setItem(CROSS_SORT_KEY, mode);
  }

  // Preferences persistence
  function getCrossPrefsKey(): string {
    return `vrt:cross-prefs:${projectId}`;
  }

  function loadCrossPrefs(): CrossPrefs | null {
    if (typeof localStorage === 'undefined') return null;
    try {
      const raw = localStorage.getItem(getCrossPrefsKey());
      if (!raw) return null;
      const parsed = JSON.parse(raw) as CrossPrefs;
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
      return null;
    }
  }

  function saveCrossPrefs(): void {
    if (typeof localStorage === 'undefined') return;
    const payload: CrossPrefs = {
      searchQuery: crossSearchQuery,
      statusFilter: [...crossStatusFilter],
      hideApproved: crossHideApproved,
      selectedKey: selectedCrossKey ?? null,
    };
    localStorage.setItem(getCrossPrefsKey(), JSON.stringify(payload));
  }

  function hasCrossReportResults(report: CrossResultsSummary | null | undefined): boolean {
    return !!report && !!report.generatedAt;
  }

  function getReportByKey(key: string | null): CrossResultsSummary | null {
    if (!key) return null;
    return crossReports.find((report) => report.key === key) ?? null;
  }

  function toSummaryFromCrossReport(report: CrossReport): CrossResultsSummary {
    const pairMatch = report.title.match(/^Cross Compare:\s+(.+)\s+vs\s+(.+)$/i);
    const baselineLabel = pairMatch?.[1] ?? '';
    const testLabel = pairMatch?.[2] ?? '';
    return {
      key: report.key,
      title: report.title,
      generatedAt: '',
      baselineLabel,
      testLabel,
      itemCount: 0,
      approvedCount: 0,
      smartPassCount: 0,
      matchCount: 0,
      diffCount: 0,
      issueCount: 0,
      flaggedCount: 0,
      outdatedCount: 0,
    };
  }

  function keepUniqueReports(reports: CrossResultsSummary[]): CrossResultsSummary[] {
    const map = new Map<string, CrossResultsSummary>();
    for (const report of reports) {
      if (!map.has(report.key)) map.set(report.key, report);
    }
    return [...map.values()];
  }

  let crossProgressTimer: ReturnType<typeof setInterval> | null = null;

  function stopCrossProgressTimer() {
    if (!crossProgressTimer) return;
    clearInterval(crossProgressTimer);
    crossProgressTimer = null;
  }

  function startCrossProgress(label: string) {
    stopCrossProgressTimer();
    crossRunProgress = 4;
    crossRunProgressLabel = label;
    crossProgressTimer = setInterval(() => {
      crossRunProgress = Math.min(
        99,
        crossRunProgress + Math.max(1, Math.round((99 - crossRunProgress) * 0.08))
      );
    }, 320);
  }

  function advanceCrossProgress(minProgress: number, label?: string) {
    crossRunProgress = Math.max(crossRunProgress, minProgress);
    if (label) crossRunProgressLabel = label;
  }

  function finishCrossProgress() {
    stopCrossProgressTimer();
    crossRunProgress = 100;
    crossRunProgressLabel = 'Cross-compare complete';
    setTimeout(() => {
      if (!crossCompareRunning) {
        crossRunProgress = 0;
        crossRunProgressLabel = '';
      }
    }, 700);
  }

  function resetCrossProgress() {
    stopCrossProgressTimer();
    crossRunProgress = 0;
    crossRunProgressLabel = '';
  }

  function applyCrossPrefs(reports: CrossResultsSummary[]): void {
    const prefs = loadCrossPrefs();
    if (!prefs) {
      crossPrefsLoaded = true;
      return;
    }

    crossPrefsApplying = true;
    crossSearchQuery = typeof prefs.searchQuery === 'string' ? prefs.searchQuery : '';
    crossHideApproved = !!prefs.hideApproved;

    if (Array.isArray(prefs.statusFilter)) {
      const allowed = new Set(CROSS_STATUS_VALUES);
      const filtered = prefs.statusFilter.filter((value) => allowed.has(value));
      crossStatusFilter = new Set(filtered.length ? filtered : ['all']);
    }

    if (prefs.selectedKey && reports.some((report) => report.key === prefs.selectedKey)) {
      selectedCrossKey = prefs.selectedKey;
    }

    crossPrefsApplying = false;
    crossPrefsLoaded = true;
  }

  // Cross-compare CRUD operations
  async function runCrossCompare(options?: {
    key?: string;
    itemKeys?: string[];
    resetAcceptances?: boolean;
  }) {
    crossCompareRunning = true;
    crossCompareError = null;
    startCrossProgress(options?.key ? 'Running selected pair...' : 'Running all pairs...');
    let success = false;
    try {
      const runResponse = await crossCompare.run(projectId, options);
      advanceCrossProgress(68, 'Refreshing pair list...');
      const list = await crossCompare.list(projectId);
      const fallbackFromRun = (runResponse.reports ?? []).map(toSummaryFromCrossReport);
      crossReports = keepUniqueReports(
        list.results.length > 0 ? list.results : fallbackFromRun
      );
      advanceCrossProgress(82, 'Loading results...');
      const nextKey = options?.key ?? crossReports[0]?.key ?? null;
      const ranKeys = new Set((runResponse.reports ?? []).map((report) => report.key));
      if (nextKey) {
        selectedCrossKey = nextKey;
        const nextReport = getReportByKey(nextKey);
        if (hasCrossReportResults(nextReport) || ranKeys.has(nextKey)) {
          await loadCrossResults(nextKey);
        } else {
          crossResults = null;
          crossResultsError = null;
        }
        onSetActiveTab('cross');
      }
      advanceCrossProgress(96);
      success = true;
    } catch (err) {
      crossCompareError = getErrorMessage(err, 'Cross compare failed');
    } finally {
      crossCompareRunning = false;
      if (success) finishCrossProgress();
      else resetCrossProgress();
    }
  }

  function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function getItemKey(item: CrossResultItem): string {
    return item.itemKey ?? `${item.scenario}__${item.viewport}`;
  }

  function getFilenameFromRelativePath(path: string): string {
    const parts = path.split(/[/\\\\]/g);
    return parts[parts.length - 1] || path;
  }

  function parseIsoDate(value?: string): number {
    if (!value) return 0;
    const t = Date.parse(value);
    return Number.isFinite(t) ? t : 0;
  }

  function getCrossItemLastUpdatedAt(item: CrossResultItem): string | null {
    // Prefer underlying screenshot mtimes (baseline/test) rather than diff mtime.
    const times = [parseIsoDate(item.baselineUpdatedAt), parseIsoDate(item.testUpdatedAt)].filter(
      (t) => t > 0
    );
    if (times.length === 0) return null;
    const max = Math.max(...times);
    return new Date(max).toISOString();
  }

  function formatUpdatedAt(iso?: string | null): string {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleString();
  }

  async function waitForTestJob(jobId: string) {
    // Poll status (simple + reliable). Server also supports SSE, but polling keeps UI logic small.
    for (;;) {
      const status = await test.status(projectId, jobId);
      crossTestJob = { id: status.id, progress: status.progress, total: status.total };
      if (status.status !== 'running') return status;
      await sleep(750);
    }
  }

  async function rerunTestsForItems(items: CrossResultItem[]) {
    if (items.length === 0) return;
    crossTestRunning = true;
    crossTestError = null;
    crossTestJob = null;

    const crossKey = selectedCrossKey;
    const itemKeys = [...new Set(items.map(getItemKey))];
    const filenames = [
      ...new Set(
        items.flatMap((item) => [
          getFilenameFromRelativePath(item.baseline),
          getFilenameFromRelativePath(item.test),
        ])
      ),
    ];

    try {
      const started = await test.rerun(projectId, filenames);
      await waitForTestJob(started.jobId);

      // Refresh diffs for just the affected items.
      if (crossKey) {
        await runCrossCompare({
          key: crossKey,
          itemKeys,
          resetAcceptances: true,
        });
      }
    } catch (err) {
      crossTestError = getErrorMessage(err, 'Failed to rerun tests');
    } finally {
      crossTestRunning = false;
      crossTestJob = null;
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

  async function rerunSelectedCrossItemTests() {
    if (!crossResults || selectedCrossItems.size === 0) return;
    const wanted = selectedCrossItems;
    const items = crossResults.items.filter((item) => wanted.has(getItemKey(item)));
    await rerunTestsForItems(items);
  }

  async function rerunFilteredCrossItemTests() {
    if (crossFilteredItems.length === 0) return;
    await rerunTestsForItems(crossFilteredItems);
  }

  async function clearCrossPair() {
    if (!selectedCrossKey) return;
    const selectedReport = getReportByKey(selectedCrossKey);
    if (!hasCrossReportResults(selectedReport)) {
      crossResults = null;
      crossResultsError = null;
      return;
    }
    if (!confirm(`Delete cross compare results for "${selectedCrossKey}"? This will remove reports, diffs, and approvals.`)) {
      return;
    }

    crossResultsError = null;
    try {
      await crossCompare.clear(projectId, selectedCrossKey);
      const list = await crossCompare.list(projectId);
      crossReports = list.results;

      if (crossReports.length === 0 && selectedReport) {
        crossReports = [
          {
            ...selectedReport,
            generatedAt: '',
            itemCount: 0,
            approvedCount: 0,
            smartPassCount: 0,
            matchCount: 0,
            diffCount: 0,
            issueCount: 0,
            flaggedCount: 0,
            outdatedCount: 0,
          },
        ];
      }

      if (crossReports.length > 0) {
        const nextKey = crossReports[0].key;
        selectedCrossKey = nextKey;
        const nextReport = getReportByKey(nextKey);
        if (hasCrossReportResults(nextReport)) {
          await loadCrossResults(nextKey);
        } else {
          crossResults = null;
          crossResultsError = null;
        }
      } else {
        selectedCrossKey = null;
        crossResults = null;
      }
    } catch (err) {
      crossResultsError = getErrorMessage(err, 'Failed to clear cross compare results');
    }
  }

  async function runAITriage(itemKeys?: string[]) {
    if (!selectedCrossKey) return;
    aiTriageRunning = true;
    aiTriageError = null;
    try {
      await crossCompare.aiTriage(projectId, selectedCrossKey, itemKeys);
      await loadCrossResults(selectedCrossKey);
    } catch (err) {
      aiTriageError = getErrorMessage(err, 'AI triage failed');
    } finally {
      aiTriageRunning = false;
    }
  }

  async function revalidateOutdated() {
    if (!selectedCrossKey || !crossResults) return;
    const outdatedKeys = crossResults.items
      .filter((i) => i.outdated)
      .map((i) => i.itemKey ?? `${i.scenario}__${i.viewport}`);
    if (outdatedKeys.length === 0) return;
    await runCrossCompare({ key: selectedCrossKey, itemKeys: outdatedKeys, resetAcceptances: true });
  }

  async function approveSelectedCrossItems() {
    if (!selectedCrossKey || !crossResults || selectedCrossItems.size === 0) return;
    const wanted = selectedCrossItems;
    const items = crossResults.items.filter((item) => wanted.has(getItemKey(item)) && !item.accepted);
    if (items.length === 0) return;

    crossApproveRunning = true;
    crossApproveProgress = 0;
    crossApproveTotal = items.length;
    const failed: string[] = [];

    try {
      for (const item of items) {
        try {
          await approveCrossItem(item, { refresh: false });
        } catch {
          failed.push(item.itemKey ?? `${item.scenario}__${item.viewport}`);
        } finally {
          crossApproveProgress += 1;
        }
      }

      await loadCrossResults(selectedCrossKey);
      await refreshCrossReports();

      if (failed.length > 0) {
        crossResultsError = `Approved ${items.length - failed.length} item(s), failed ${failed.length}.`;
      }
    } finally {
      crossApproveRunning = false;
    }
  }

  async function deleteCrossItems() {
    if (!selectedCrossKey || selectedCrossItems.size === 0) return;
    const itemKeys = [...selectedCrossItems];

    if (!confirm(`Delete ${itemKeys.length} cross compare item(s)? This will hide them from results.`)) {
      return;
    }

    crossResultsError = null;
    try {
      await crossCompare.deleteItems(projectId, selectedCrossKey, itemKeys);
      selectedCrossItems = new Set();
      await loadCrossResults(selectedCrossKey);
      await refreshCrossReports();
    } catch (err) {
      crossResultsError = getErrorMessage(err, 'Failed to delete cross compare items');
    }
  }

  async function deleteCrossItem(item: CrossResultItem) {
    if (!selectedCrossKey) return;
    const itemKey = item.itemKey ?? `${item.scenario}__${item.viewport}`;
    if (!itemKey) return;
    crossResultsError = null;
    try {
      await crossCompare.deleteItems(projectId, selectedCrossKey, [itemKey]);
      await loadCrossResults(selectedCrossKey);
      await refreshCrossReports();
    } catch (err) {
      crossResultsError = getErrorMessage(err, 'Failed to delete cross compare item');
    }
  }

  async function loadCrossResults(key: string) {
    crossResultsLoading = true;
    crossResultsError = null;
    try {
      const result = await crossCompare.getResults(projectId, key);
      crossResults = result.results;
      selectedCrossItems = new Set();
    } catch (err) {
      crossResultsError = getErrorMessage(err, 'Failed to load cross compare results');
    } finally {
      crossResultsLoading = false;
    }
  }

  async function refreshCrossReports() {
    try {
      const list = await crossCompare.list(projectId);
      crossReports = list.results;
    } catch (err) {
      crossResultsError = getErrorMessage(err, 'Failed to refresh cross compare pairs');
    }
  }

  async function handleCrossPairChange(event: Event) {
    const target = event.target as HTMLSelectElement;
    const key = target.value;
    selectedCrossKey = key;
    const report = getReportByKey(key);
    if (key && hasCrossReportResults(report)) {
      await loadCrossResults(key);
    } else {
      crossResults = null;
      crossResultsError = null;
    }
  }

  async function approveCrossItem(
    item: CrossResultItem,
    options: { refresh?: boolean } = {}
  ) {
    if (!selectedCrossKey || !item.itemKey) return;
    const shouldRefresh = options.refresh ?? true;
    try {
      await crossCompare.accept(projectId, selectedCrossKey, item.itemKey);
      if (shouldRefresh) {
        await loadCrossResults(selectedCrossKey);
        await refreshCrossReports();
      }
    } catch (err) {
      crossResultsError = getErrorMessage(err, 'Failed to approve cross item');
      throw err;
    }
  }

  async function revokeCrossItem(item: CrossResultItem) {
    if (!selectedCrossKey || !item.itemKey) return;
    try {
      await crossCompare.revoke(projectId, selectedCrossKey, item.itemKey);
      await loadCrossResults(selectedCrossKey);
      await refreshCrossReports();
    } catch (err) {
      crossResultsError = getErrorMessage(err, 'Failed to revoke cross approval');
    }
  }

  async function flagCrossItem(item: CrossResultItem) {
    if (!selectedCrossKey || !item.itemKey) return;
    try {
      await crossCompare.flag(projectId, selectedCrossKey, item.itemKey);
      await loadCrossResults(selectedCrossKey);
      await refreshCrossReports();
    } catch (err) {
      crossResultsError = getErrorMessage(err, 'Failed to flag cross item');
    }
  }

  async function unflagCrossItem(item: CrossResultItem) {
    if (!selectedCrossKey || !item.itemKey) return;
    try {
      await crossCompare.unflag(projectId, selectedCrossKey, item.itemKey);
      await loadCrossResults(selectedCrossKey);
      await refreshCrossReports();
    } catch (err) {
      crossResultsError = getErrorMessage(err, 'Failed to unflag cross item');
    }
  }

  // Filter logic
  function matchesCrossStatus(item: CrossResultItem, status: CrossStatusFilter): boolean {
    switch (status) {
      case 'diffs': return !item.match;
      case 'matches': return item.match;
      case 'smart': return item.match && item.diffPercentage > 0;
      case 'approved': return !!item.accepted;
      case 'unapproved': return !item.accepted;
      case 'flagged': return !!item.flagged;
      case 'outdated': return !!item.outdated;
      case 'ai-approved': return item.aiAnalysis?.recommendation === 'approve';
      case 'ai-review': return item.aiAnalysis?.recommendation === 'review';
      case 'ai-rejected': return item.aiAnalysis?.recommendation === 'reject';
      default: return true;
    }
  }

  function matchesCrossStatusSet(item: CrossResultItem, statuses: Set<CrossStatusFilter>): boolean {
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
    if (!multi) { setCrossStatusFilter(status); return; }
    if (status === 'all') { setCrossStatusFilter('all'); return; }
    const next = new Set(crossStatusFilter);
    if (next.has('all')) next.delete('all');
    if (next.has(status)) { next.delete(status); } else { next.add(status); }
    if (next.size === 0) next.add('all');
    crossStatusFilter = next;
  }

  function isCrossStatusActive(status: CrossStatusFilter): boolean {
    if (crossStatusFilter.has('all')) return status === 'all';
    return crossStatusFilter.has(status);
  }

  function formatCrossPairSummary(report: CrossResultsSummary): string {
    const approved = report.approvedCount ?? 0;
    const flagged = report.flaggedCount ?? 0;
    const smart = report.smartPassCount ?? 0;
    const match = report.matchCount ?? 0;
    const diff = report.diffCount ?? 0;
    const issue = report.issueCount ?? 0;
    return `A ${approved} · F ${flagged} · S ${smart} · M ${match} · D ${diff} · I ${issue}`;
  }

  // Derived state
  let crossFilteredItems = $derived.by((): CrossResultItem[] => {
    if (!crossResults) return [];
    const q = crossSearchQuery.trim().toLowerCase();
    const filtered = crossResults.items.filter((item) => {
      if (crossHideApproved && item.accepted) return false;
      if (!matchesCrossStatusSet(item, crossStatusFilter)) return false;
      if (!q) return true;
      return `${item.scenario} ${item.viewport}`.toLowerCase().includes(q);
    });
    if (crossSortMode === 'diff') {
      filtered.sort((a, b) => b.diffPercentage - a.diffPercentage);
    }
    return filtered;
  });

  let crossTotalPages = $derived(Math.ceil(crossFilteredItems.length / CROSS_PAGE_SIZE));
  let crossCurrentList = $derived(
    crossFilteredItems.slice(crossCurrentPage * CROSS_PAGE_SIZE, (crossCurrentPage + 1) * CROSS_PAGE_SIZE)
  );

  let crossPairSummary = $derived.by(() => {
    if (!crossResults) return null;
    const summary = {
      total: 0,
      approved: 0,
      smart: 0,
      match: 0,
      diff: 0,
      issue: 0,
      flagged: 0,
      outdated: 0,
    };
    for (const item of crossResults.items) {
      summary.total += 1;
      if (item.flagged) summary.flagged += 1;
      if (item.outdated) summary.outdated += 1;
      if (item.accepted) { summary.approved += 1; continue; }
      const smartPass = item.match && item.diffPercentage > 0;
      if (item.match) { if (smartPass) summary.smart += 1; else summary.match += 1; continue; }
      if (item.reason === 'diff') summary.diff += 1; else summary.issue += 1;
    }
    return summary;
  });

  let aiAnalyzedCount = $derived(crossResults?.items.filter((i) => i.aiAnalysis).length ?? 0);
  let selectedCrossHasResults = $derived(
    hasCrossReportResults(getReportByKey(selectedCrossKey)) ||
      (!!crossResults && crossResults.key === selectedCrossKey)
  );

  // Selection
  let selectedCrossCount = $derived(selectedCrossItems.size);
  let allCrossPageSelected = $derived(
    crossCurrentList.length > 0 &&
    crossCurrentList.every((item) => selectedCrossItems.has(getItemKey(item)))
  );
  let allCrossFilteredSelected = $derived(
    crossFilteredItems.length > 0 &&
    crossFilteredItems.every((item) => selectedCrossItems.has(getItemKey(item)))
  );

  function toggleCrossSelected(item: CrossResultItem) {
    const key = getItemKey(item);
    const next = new Set(selectedCrossItems);
    if (next.has(key)) { next.delete(key); } else { next.add(key); }
    selectedCrossItems = next;
  }

  function selectAllCross() {
    if (crossFilteredItems.length === 0) return;
    if (allCrossFilteredSelected) return;
    if (allCrossPageSelected && crossTotalPages > 1) {
      selectedCrossItems = new Set(crossFilteredItems.map(getItemKey));
    } else {
      selectedCrossItems = new Set(crossCurrentList.map(getItemKey));
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

  function openCrossCompare(item: CrossResultItem) {
    if (!crossResults) return;
    const index = crossFilteredItems.findIndex((entry) => entry.itemKey === item.itemKey);
    onOpenCrossCompare(item, index === -1 ? 0 : index, crossFilteredItems, crossResults);
  }

  // Effects
  $effect(() => {
    crossSearchQuery; crossStatusFilter; selectedCrossKey;
    crossCurrentPage = 0;
  });

  $effect(() => {
    if (!crossPrefsLoaded || crossPrefsApplying) return;
    crossSearchQuery; crossStatusFilter; crossHideApproved; selectedCrossKey;
    saveCrossPrefs();
  });

  $effect(() => {
    const maxPage = Math.max(0, crossTotalPages - 1);
    if (crossCurrentPage > maxPage) crossCurrentPage = maxPage;
  });

  $effect(() => {
    if (crossReports.length === 0) {
      if (selectedCrossKey) { selectedCrossKey = null; crossResults = null; }
      return;
    }
    const stillSelected = crossReports.some((report) => report.key === selectedCrossKey);
    if (!stillSelected) {
      selectedCrossKey = crossReports[0].key;
    }

    const selectedReport = getReportByKey(selectedCrossKey);
    if (selectedCrossKey && hasCrossReportResults(selectedReport)) {
      if (crossResults?.key !== selectedCrossKey) {
        loadCrossResults(selectedCrossKey);
      }
    } else if (selectedCrossKey) {
      crossResults = null;
      crossResultsError = null;
    }
  });

  // Initialize: apply preferences and load results
  export function initialize(reports: CrossResultsSummary[]) {
    if (!crossPrefsLoaded) {
      applyCrossPrefs(reports);
    }
    if (selectedCrossKey && !reports.some((report) => report.key === selectedCrossKey)) {
      selectedCrossKey = null;
    }
    if (!selectedCrossKey && reports.length > 0) {
      selectedCrossKey = reports[0].key;
    }
    const selectedReport = getReportByKey(selectedCrossKey);
    if (selectedCrossKey && hasCrossReportResults(selectedReport)) {
      loadCrossResults(selectedCrossKey);
    } else {
      crossResults = null;
      crossResultsError = null;
    }
  }

  export function resetPrefs() {
    crossPrefsLoaded = false;
    crossPrefsApplying = false;
  }

  /** Expose filtered items and results for fullscreen compare modal in parent */
  export function getCrossState() {
    return {
      crossFilteredItems,
      crossResults,
      selectedCrossKey,
      crossCompareRunning,
      crossTestRunning,
      aiTriageRunning,
      crossApproveRunning,
      crossApproveProgress,
      crossApproveTotal,
      selectedCrossItems,
      selectedCrossCount,
    };
  }

  /** Exposed actions for parent BulkActionBar */
  export {
    approveSelectedCrossItems,
    rerunSelectedCrossItems,
    rerunSelectedCrossItemTests,
    deleteCrossItems,
    selectAllCross,
    deselectAllCross,
    runAITriage,
  };

  /** Called from parent after approve/revoke in fullscreen modal */
  export async function approveCrossFromModal(item: CrossResultItem) {
    await approveCrossItem(item);
  }

  export async function revokeCrossFromModal(item: CrossResultItem) {
    await revokeCrossItem(item);
  }

  export async function flagCrossFromModal(item: CrossResultItem) {
    await flagCrossItem(item);
  }

  export async function unflagCrossFromModal(item: CrossResultItem) {
    await unflagCrossItem(item);
  }
</script>

<div class="cross-content">
  <div class="cross-toolbar">
    <div class="cross-select">
      <label for="cross-pair-select">Pair</label>
      <select id="cross-pair-select" onchange={handleCrossPairChange} bind:value={selectedCrossKey}>
        <option value="" disabled selected={!selectedCrossKey}>Select a cross compare pair</option>
        {#each crossReports as report}
          <option value={report.key}>
            {report.title}
            {#if hasCrossReportResults(report)}
              {' '}· {formatCrossPairSummary(report)}
            {:else}
              {' '}· Not generated yet
            {/if}
          </option>
        {/each}
      </select>
    </div>
    <button class="btn" onclick={() => runCrossCompare()} disabled={crossCompareRunning}>
      {crossCompareRunning ? 'Cross Comparing...' : 'Run All Pairs'}
    </button>
    <button class="btn" onclick={runSelectedCrossPair} disabled={!selectedCrossKey || crossCompareRunning}>
      {crossCompareRunning ? 'Cross Comparing...' : 'Run Pair'}
    </button>
    <button
      class="btn danger"
      onclick={clearCrossPair}
      disabled={!selectedCrossKey || !selectedCrossHasResults || crossCompareRunning}
      title="Re-run pair to regenerate"
    >
      Clear Results
    </button>
  </div>

  {#if crossCompareRunning}
    <div class="cross-run-progress" role="status" aria-live="polite">
      <div class="cross-run-progress-head">
        <span>{crossRunProgressLabel || 'Running cross compare...'}</span>
        <span>{Math.round(crossRunProgress)}%</span>
      </div>
      <div class="cross-run-progress-track">
        <div class="cross-run-progress-fill" style="width: {crossRunProgress}%"></div>
      </div>
    </div>
  {/if}

  <div class="search-bar cross-search-bar">
    <input type="text" class="search-input" placeholder="Filter by scenario or viewport..." bind:value={crossSearchQuery} />
    {#if crossSearchQuery}
      <button class="clear-btn" onclick={() => crossSearchQuery = ''}>x</button>
    {/if}
    <span class="result-count">
      {crossFilteredItems.length} of {crossResults?.items.length || 0} items
    </span>
    <div class="tag-filters" title="Cmd/Ctrl-click to multi-select">
      <button class="tag-filter tag-all" class:active={isCrossStatusActive('all')} onclick={(event) => toggleCrossStatusFilter('all', event)} title="Show all items regardless of status">All</button>
      <button class="tag-filter tag-diff" class:active={isCrossStatusActive('diffs')} onclick={(event) => toggleCrossStatusFilter('diffs', event)} title="Items with visual diffs">Diffs</button>
      <button class="tag-filter tag-passed" class:active={isCrossStatusActive('matches')} onclick={(event) => toggleCrossStatusFilter('matches', event)} title="Items that match">Matches</button>
      <button class="tag-filter tag-smart" class:active={isCrossStatusActive('smart')} onclick={(event) => toggleCrossStatusFilter('smart', event)} title="Matches with non-zero diffs (smart pass)">Smart Pass</button>
      <button class="tag-filter tag-approved" class:active={isCrossStatusActive('approved')} onclick={(event) => toggleCrossStatusFilter('approved', event)} title="Items you have approved">Approved</button>
      <button class="tag-filter tag-flagged" class:active={isCrossStatusActive('flagged')} onclick={(event) => toggleCrossStatusFilter('flagged', event)} title="Items flagged for later review">Flagged</button>
      <button class="tag-filter tag-unapproved" class:active={isCrossStatusActive('unapproved')} onclick={(event) => toggleCrossStatusFilter('unapproved', event)} title="Items not yet approved">Unapproved</button>
      {#if crossPairSummary && crossPairSummary.outdated > 0}
        <button class="tag-filter tag-outdated" class:active={isCrossStatusActive('outdated')} onclick={(event) => toggleCrossStatusFilter('outdated', event)} title="Items where screenshots changed after comparison ran">Outdated ({crossPairSummary.outdated})</button>
      {/if}
      {#if aiAnalyzedCount > 0}
        <button class="tag-filter tag-ai-approved" class:active={isCrossStatusActive('ai-approved')} onclick={(event) => toggleCrossStatusFilter('ai-approved', event)} title="AI recommends approve">AI Approve</button>
        <button class="tag-filter tag-ai-review" class:active={isCrossStatusActive('ai-review')} onclick={(event) => toggleCrossStatusFilter('ai-review', event)} title="AI recommends review">AI Review</button>
        <button class="tag-filter tag-ai-rejected" class:active={isCrossStatusActive('ai-rejected')} onclick={(event) => toggleCrossStatusFilter('ai-rejected', event)} title="AI recommends reject">AI Reject</button>
      {/if}
      <button class="tag-filter" class:active={crossHideApproved} onclick={() => crossHideApproved = !crossHideApproved} title="Hide approved items from results">Hide Approved</button>
    </div>
    <div class="cross-selection-controls">
      <span class="view-divider"></span>
      <button class="view-toggle" class:active={crossViewMode === 'grid'} onclick={() => setCrossViewMode('grid')} title="Grid view">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
      </button>
      <button class="view-toggle" class:active={crossViewMode === 'list'} onclick={() => setCrossViewMode('list')} title="List view">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
      </button>
      <span class="view-divider"></span>
      <button class="sort-toggle" class:active={crossSortMode === 'diff'} onclick={() => setCrossSortMode(crossSortMode === 'diff' ? 'name' : 'diff')} title={crossSortMode === 'diff' ? 'Sort by name' : 'Sort by diff % (highest first)'}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M3 12h12M3 18h6"/></svg>
        {crossSortMode === 'diff' ? '% ↓' : 'A-Z'}
      </button>
    </div>
  </div>

  {#if crossCompareError}
    <div class="error">{crossCompareError}</div>
  {/if}
  {#if crossTestError}
    <div class="error">{crossTestError}</div>
  {/if}
  {#if crossResultsError}
    <div class="error">{crossResultsError}</div>
  {/if}
  {#if aiTriageError}
    <div class="error">{aiTriageError}</div>
  {/if}

  {#if crossResultsLoading}
    <div class="compare-hint">Loading cross compare results...</div>
  {:else if crossResults}
    {#if crossFilteredItems.length === 0}
      <div class="compare-hint">No cross-compare items match your filter.</div>
    {:else}
      {#if crossTotalPages > 1}
        <div class="pagination">
          <button class="btn small" onclick={() => crossCurrentPage = Math.max(0, crossCurrentPage - 1)} disabled={crossCurrentPage === 0}>Prev</button>
          <span class="page-info">Page {crossCurrentPage + 1} of {crossTotalPages} ({crossFilteredItems.length} items)</span>
          <button class="btn small" onclick={() => crossCurrentPage = Math.min(crossTotalPages - 1, crossCurrentPage + 1)} disabled={crossCurrentPage >= crossTotalPages - 1}>Next</button>
        </div>
      {/if}
      {#if crossViewMode === 'grid'}
        <div class="cross-grid">
          {#each crossCurrentList as item}
            {@const smartPass = item.match && item.diffPercentage > 0}
            {@const crossTag = item.flagged ? 'flagged' : item.accepted ? 'approved' : item.match ? smartPass ? 'smart' : 'passed' : item.reason === 'diff' ? 'diff' : 'unapproved'}
            {@const lastUpdated = getCrossItemLastUpdatedAt(item)}
            <div class="cross-card tag-{crossTag}">
              <div class="cross-card-header">
                <label class="cross-select-box">
                  <input
                    type="checkbox"
                    checked={selectedCrossItems.has(getItemKey(item))}
                    onchange={() => toggleCrossSelected(item)}
                  />
                </label>
                <div>
                  <div class="cross-title">{item.scenario}</div>
                  <div class="cross-meta">{item.viewport}</div>
                  {#if lastUpdated}
                    <div class="cross-updated" title={lastUpdated}>
                      Last updated: {formatUpdatedAt(lastUpdated)}
                    </div>
                  {/if}
                </div>
                <div class="cross-badge-group">
                  <div class="cross-badge tag-{crossTag}">
                    {item.flagged ? 'Flagged' : item.accepted ? 'Approved' : item.match ? smartPass ? 'Smart Pass' : 'Match' : item.reason === 'diff' ? 'Diff' : 'Issue'}
                  </div>
                  {#if item.outdated}
                    <div class="cross-badge tag-outdated">Outdated</div>
                  {/if}
                  {#if item.aiAnalysis}
                    {@const rec = item.aiAnalysis.recommendation}
                    {#if onOpenAIAnalysis}
                      <button
                        type="button"
                        class="cross-badge cross-badge-btn tag-ai-{rec}"
                        title="Open AI analysis: {item.aiAnalysis.category} ({(item.aiAnalysis.confidence * 100).toFixed(0)}%)"
                        onclick={(event) => {
                          event.stopPropagation();
                          onOpenAIAnalysis(item);
                        }}
                      >
                        AI: {item.aiAnalysis.category} {rec === 'approve' ? '\u2713' : rec === 'review' ? '\u26A0' : '\u2717'}
                      </button>
                    {:else}
                      <div class="cross-badge tag-ai-{rec}" title="AI: {item.aiAnalysis.category} ({(item.aiAnalysis.confidence * 100).toFixed(0)}%)">
                        AI: {item.aiAnalysis.category} {rec === 'approve' ? '\u2713' : rec === 'review' ? '\u26A0' : '\u2717'}
                      </div>
                    {/if}
                  {/if}
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
                  <img src={getFileThumbUrl(item.baseline)} alt="Baseline" loading="lazy" decoding="async" fetchpriority="low" />
                </button>
                {#if item.diff}
                  <button class="cross-image" onclick={() => openCrossCompare(item)} title="Open fullscreen compare">
                    <img src={getFileThumbUrl(item.diff)} alt="Diff" loading="lazy" decoding="async" fetchpriority="low" />
                  </button>
                {/if}
                <button class="cross-image" onclick={() => openCrossCompare(item)} title="Open fullscreen compare">
                  <img src={getFileThumbUrl(item.test)} alt="Test" loading="lazy" decoding="async" fetchpriority="low" />
                </button>
              </div>
              <div class="cross-actions">
                {#if item.accepted}
                  <button class="btn small ghost" onclick={() => revokeCrossItem(item)}>Approved · Undo</button>
                {:else}
                  <button class="btn small" onclick={() => approveCrossItem(item)}>Approve Diff</button>
                {/if}
                {#if item.flagged}
                  <button class="btn small flag" onclick={() => unflagCrossItem(item)}>Unflag</button>
                {:else}
                  <button class="btn small flag" onclick={() => flagCrossItem(item)}>Flag</button>
                {/if}
                <button
                  class="btn small rerun-tests"
                  onclick={() => rerunTestsForItems([item])}
                  disabled={crossCompareRunning || crossTestRunning}
                  title="Rerun screenshots for both browsers in this card, then refresh cross-compare for this item"
                >
                  {crossTestRunning ? 'Rerunning...' : 'Rerun Tests'}
                </button>
                <button class="btn small danger" onclick={() => deleteCrossItem(item)}>Delete</button>
              </div>
            </div>
          {/each}
        </div>
      {:else}
        <div class="cross-list">
          {#each crossCurrentList as item}
            {@const smartPass = item.match && item.diffPercentage > 0}
            {@const crossTag = item.flagged ? 'flagged' : item.accepted ? 'approved' : item.match ? smartPass ? 'smart' : 'passed' : item.reason === 'diff' ? 'diff' : 'unapproved'}
            <div
              class="cross-list-row"
              class:multi-selected={selectedCrossItems.has(getItemKey(item))}
              onclick={() => openCrossCompare(item)}
              onkeydown={(e) => e.key === 'Enter' && openCrossCompare(item)}
              role="button"
              tabindex="0"
            >
              <label class="list-checkbox" onclick={(e) => e.stopPropagation()}>
                <input
                  type="checkbox"
                  checked={selectedCrossItems.has(getItemKey(item))}
                  onchange={() => toggleCrossSelected(item)}
                />
                <span class="checkmark"></span>
              </label>
              <div class="cross-list-thumb">
                <img src={getFileThumbUrl(item.baseline)} alt="Baseline" loading="lazy" decoding="async" fetchpriority="low" />
              </div>
              <div class="cross-list-info">
                <span class="cross-list-scenario">{item.scenario}</span>
                <span class="cross-list-detail">{item.viewport}</span>
              </div>
              <span class="cross-list-diff" style="color: {getDiffColor(item.diffPercentage)}">
                {item.diffPercentage.toFixed(2)}%
              </span>
              {#if item.ssimScore !== undefined}
                <span class="cross-list-ssim">
                  SSIM {(item.ssimScore * 100).toFixed(1)}%
                </span>
              {/if}
              <div class="cross-badge tag-{crossTag}">
                {item.flagged ? 'Flagged' : item.accepted ? 'Approved' : item.match ? smartPass ? 'Smart Pass' : 'Match' : item.reason === 'diff' ? 'Diff' : 'Issue'}
              </div>
              {#if item.outdated}
                <div class="cross-badge tag-outdated">Outdated</div>
              {/if}
              {#if item.aiAnalysis}
                {@const rec = item.aiAnalysis.recommendation}
                {#if onOpenAIAnalysis}
                  <button
                    type="button"
                    class="cross-badge cross-badge-btn tag-ai-{rec}"
                    title="Open AI analysis: {item.aiAnalysis.category} ({(item.aiAnalysis.confidence * 100).toFixed(0)}%)"
                    onclick={(event) => {
                      event.stopPropagation();
                      onOpenAIAnalysis(item);
                    }}
                  >
                    AI {rec === 'approve' ? '\u2713' : rec === 'review' ? '\u26A0' : '\u2717'} {(item.aiAnalysis.confidence * 100).toFixed(0)}%
                  </button>
                {:else}
                  <div class="cross-badge tag-ai-{rec}" title="{item.aiAnalysis.category} ({(item.aiAnalysis.confidence * 100).toFixed(0)}%)">
                    AI {rec === 'approve' ? '\u2713' : rec === 'review' ? '\u26A0' : '\u2717'} {(item.aiAnalysis.confidence * 100).toFixed(0)}%
                  </div>
                {/if}
              {/if}
            </div>
          {/each}
        </div>
      {/if}
    {/if}
    <div class="cross-summary-line">
      {#if crossPairSummary}
        Pair: {crossResults.baselineLabel} vs {crossResults.testLabel}
        · Generated: {new Date(crossResults.generatedAt).toLocaleString()}
        {#if crossTestRunning && crossTestJob}
          · Rerunning tests: {crossTestJob.progress} / {crossTestJob.total}
        {/if}
        · Items: {crossPairSummary.total}
        · Approved: {crossPairSummary.approved}
        · Smart Pass: {crossPairSummary.smart}
        · Match: {crossPairSummary.match}
        · Diff: {crossPairSummary.diff}
        · Issue: {crossPairSummary.issue}
        {#if crossPairSummary.flagged > 0}
          · Flagged: {crossPairSummary.flagged}
        {/if}
        {#if crossPairSummary.outdated > 0}
          · <span class="outdated-indicator">Outdated: {crossPairSummary.outdated}</span>
          <button class="btn small rerun-tests" onclick={revalidateOutdated} disabled={crossCompareRunning} title="Re-compare outdated items">
            Re-validate
          </button>
        {/if}
        {#if aiTriageRunning}
          · <span class="ai-running">AI Triage running...</span>
        {/if}
      {:else}
        Pair: {crossResults.baselineLabel} vs {crossResults.testLabel}
        · Generated: {new Date(crossResults.generatedAt).toLocaleString()}
        {#if crossTestRunning && crossTestJob}
          · Rerunning tests: {crossTestJob.progress} / {crossTestJob.total}
        {/if}
        · Items: {crossFilteredItems.length}
      {/if}
    </div>
  {:else}
    <div class="compare-hint">
      {#if selectedCrossKey}
        Pair selected but no results yet. Click "Run Pair" or "Run All Pairs".
      {:else}
        Run cross compare to generate results for browser pairs.
      {/if}
    </div>
  {/if}
</div>

<style>
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
    font-size: 0.9rem;
  }

  .cross-search-bar {
    border-radius: 0;
  }

  .cross-run-progress {
    border: 1px solid var(--border);
    background: var(--panel);
    padding: 0.55rem 0.65rem;
    border-radius: 0;
  }

  .cross-run-progress-head {
    display: flex;
    justify-content: space-between;
    font-size: 0.74rem;
    color: var(--text-muted);
    margin-bottom: 0.35rem;
  }

  .cross-run-progress-track {
    height: 6px;
    background: var(--border-soft);
    overflow: hidden;
  }

  .cross-run-progress-fill {
    height: 100%;
    background: var(--accent);
    transition: width 0.25s ease;
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
    border: 2px solid var(--border-soft);
    border-radius: 0;
    padding: 0.8rem;
    display: flex;
    flex-direction: column;
    gap: 0.8rem;
    content-visibility: auto;
    contain: layout paint;
    contain-intrinsic-size: 280px 260px;
  }

  .cross-card.tag-approved { border-color: rgba(34, 197, 94, 0.6); }
  .cross-card.tag-flagged { border-color: rgba(255, 107, 0, 0.9); box-shadow: inset 0 0 0 1px rgba(255, 107, 0, 0.28); }
  .cross-card.tag-smart { border-color: rgba(20, 184, 166, 0.6); }
  .cross-card.tag-unapproved { border-color: rgba(239, 68, 68, 0.6); }
  .cross-card.tag-new { border-color: rgba(245, 158, 11, 0.7); }
  .cross-card.tag-diff { border-color: rgba(249, 115, 22, 0.7); }
  .cross-card.tag-passed { border-color: rgba(56, 189, 248, 0.7); }

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

  .cross-updated {
    font-size: 0.72rem;
    color: var(--text-muted);
    margin-top: 0.1rem;
    opacity: 0.9;
  }

  .cross-badge {
    font-size: 0.7rem;
    font-weight: 600;
    padding: 0.2rem 0.5rem;
    border-radius: 0;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    border: 1px solid var(--border);
    background: var(--panel-strong);
    color: var(--text-muted);
  }

  .cross-badge.tag-approved { background: rgba(34, 197, 94, 0.12); border-color: rgba(34, 197, 94, 0.4); color: var(--tag-approved); }
  .cross-badge.tag-flagged { background: rgba(255, 107, 0, 0.14); border-color: rgba(255, 107, 0, 0.65); color: var(--tag-flagged); }
  .cross-badge.tag-smart { background: rgba(20, 184, 166, 0.12); border-color: rgba(20, 184, 166, 0.4); color: var(--tag-smart); }
  .cross-badge.tag-unapproved { background: rgba(239, 68, 68, 0.12); border-color: rgba(239, 68, 68, 0.4); color: var(--tag-unapproved); }
  .cross-badge.tag-new { background: rgba(245, 158, 11, 0.12); border-color: rgba(245, 158, 11, 0.45); color: var(--tag-new); }
  .cross-badge.tag-diff { background: rgba(249, 115, 22, 0.12); border-color: rgba(249, 115, 22, 0.45); color: var(--tag-diff); }
  .cross-badge.tag-passed { background: rgba(56, 189, 248, 0.12); border-color: rgba(56, 189, 248, 0.45); color: var(--tag-passed); }

  .cross-badge.cross-badge-btn {
    cursor: pointer;
    font-family: inherit;
    line-height: inherit;
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

  .cross-actions .btn { padding: 0.35rem 0.75rem; }

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

  /* Shared styles needed by this component */
  .btn {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 1rem;
    border: none;
    border-radius: 0;
    background: var(--border);
    color: var(--text-strong);
    font-size: 0.875rem;
    font-family: var(--font-mono, monospace);
    text-transform: lowercase;
    cursor: pointer;
    transition: background 0.2s;
  }
  .btn:hover { background: var(--border-soft); }
  .btn.danger { background: #7f1d1d; color: #fff; }
  .btn.danger:hover { background: #ef4444; }
  .btn.small { padding: 0.375rem 0.75rem; font-size: 0.8rem; }
  .btn.ghost { background: transparent; border: 1px solid var(--border); color: var(--text-muted); }
  .btn.ghost:hover:not(:disabled) { border-color: var(--accent); color: var(--text-strong); }
  .btn.small.expanded { background: var(--accent); color: #fff; }
  .btn.small.all-selected { background: #22c55e; color: #fff; }
  .btn.small.rerun { background: transparent; border: 1px solid var(--accent); color: var(--accent); }
  .btn.small.rerun:hover:not(:disabled) { background: var(--accent); color: #fff; }
  .btn.small.flag { background: transparent; border: 1px solid #ff6b00; color: #ff6b00; }
  .btn.small.flag:hover:not(:disabled) { background: #ff6b00; color: #111827; }
  .btn.small.rerun-tests { background: transparent; border: 1px solid #f59e0b; color: #f59e0b; }
  .btn.small.rerun-tests:hover:not(:disabled) { background: #f59e0b; color: #111827; }

  .error {
    background: #7f1d1d;
    border: 1px solid #ef4444;
    padding: 0.75rem 1rem;
    border-radius: 0;
    margin-bottom: 1rem;
  }

  .compare-hint {
    text-align: center;
    padding: 3rem;
    color: var(--text-muted);
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 0;
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
    font-size: 0.875rem;
  }
  .search-bar .search-input:focus { outline: none; border-color: var(--accent); }
  .search-bar .search-input::placeholder { color: var(--text-muted); }
  .search-bar .clear-btn { background: none; border: none; color: var(--text-muted); font-size: 1.25rem; cursor: pointer; padding: 0 0.25rem; line-height: 1; }
  .search-bar .clear-btn:hover { color: var(--text-strong); }
  .search-bar .result-count { font-size: 0.75rem; color: var(--text-muted); white-space: nowrap; }

  .tag-filters {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
    align-items: center;
  }

  .tag-filter {
    padding: 0.28rem 0.6rem;
    border-radius: 0;
    border: 1px solid transparent;
    background: var(--panel-strong);
    color: var(--text-muted);
    font-size: 0.65rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    cursor: pointer;
    opacity: 0.24;
    transition: opacity 0.15s, border-color 0.15s, color 0.15s, background 0.15s;
  }
  .tag-filter.active { opacity: 1; color: var(--text-strong); }
  .tag-filter.tag-approved { border-color: rgba(34, 197, 94, 0.4); background: rgba(34, 197, 94, 0.12); color: var(--tag-approved); }
  .tag-filter.tag-flagged { border-color: rgba(255, 107, 0, 0.6); background: rgba(255, 107, 0, 0.16); color: var(--tag-flagged); }
  .tag-filter.tag-smart { border-color: rgba(20, 184, 166, 0.4); background: rgba(20, 184, 166, 0.12); color: var(--tag-smart); }
  .tag-filter.tag-unapproved { border-color: rgba(239, 68, 68, 0.4); background: rgba(239, 68, 68, 0.12); color: var(--tag-unapproved); }
  .tag-filter.tag-new { border-color: rgba(245, 158, 11, 0.45); background: rgba(245, 158, 11, 0.12); color: var(--tag-new); }
  .tag-filter.tag-diff { border-color: rgba(249, 115, 22, 0.45); background: rgba(249, 115, 22, 0.12); color: var(--tag-diff); }
  .tag-filter.tag-passed { border-color: rgba(56, 189, 248, 0.45); background: rgba(56, 189, 248, 0.12); color: var(--tag-passed); }

  .selected-count {
    font-size: 0.8rem;
    color: var(--accent);
    font-weight: 500;
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

  /* View toggle */
  .view-divider { width: 1px; height: 16px; background: var(--border); }
  .view-toggle {
    display: inline-flex; align-items: center; justify-content: center;
    width: 28px; height: 28px; padding: 0; border: 1px solid var(--border);
    background: transparent; color: var(--text-muted); cursor: pointer; transition: all 0.15s;
  }
  .view-toggle:hover { color: var(--text-strong); border-color: var(--text-muted); }
  .view-toggle.active { color: var(--accent); border-color: var(--accent); background: rgba(99, 102, 241, 0.1); }

  .sort-toggle {
    display: inline-flex; align-items: center; gap: 0.3rem;
    padding: 0 0.5rem; height: 28px; border: 1px solid var(--border);
    background: transparent; color: var(--text-muted); cursor: pointer;
    font-size: 0.7rem; font-family: var(--font-mono, monospace); transition: all 0.15s;
  }
  .sort-toggle:hover { color: var(--text-strong); border-color: var(--text-muted); }
  .sort-toggle.active { color: var(--accent); border-color: var(--accent); background: rgba(99, 102, 241, 0.1); }

  /* Cross list view */
  .cross-list { display: flex; flex-direction: column; }

  .cross-list-row {
    display: flex; align-items: center; gap: 0.75rem;
    padding: 0.5rem 0.75rem;
    border-bottom: 1px solid var(--border-soft);
    cursor: pointer; transition: background 0.1s;
  }
  .cross-list-row:hover { background: var(--panel-soft); }
  .cross-list-row.multi-selected { background: rgba(99, 102, 241, 0.08); }

  .list-checkbox {
    display: flex; align-items: center; flex-shrink: 0;
    position: relative; cursor: pointer;
  }
  .list-checkbox input { position: absolute; opacity: 0; cursor: pointer; height: 0; width: 0; }
  .list-checkbox .checkmark {
    display: block; width: 16px; height: 16px; background: var(--panel-strong);
    border: 2px solid var(--text-muted); border-radius: 0; cursor: pointer; transition: all 0.15s;
  }
  .list-checkbox:hover .checkmark { border-color: var(--accent); }
  .list-checkbox input:checked ~ .checkmark { background: var(--accent); border-color: var(--accent); }
  .list-checkbox input:checked ~ .checkmark::after {
    content: ''; position: absolute; left: 5px; top: 1px;
    width: 4px; height: 8px; border: solid var(--text-strong);
    border-width: 0 2px 2px 0; transform: rotate(45deg);
  }

  .cross-list-thumb {
    width: 40px; height: 40px; flex-shrink: 0;
    background: var(--panel-strong); border: 1px solid var(--border); overflow: hidden;
  }
  .cross-list-thumb img { width: 100%; height: 100%; object-fit: contain; }

  .cross-list-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 0.1rem; }
  .cross-list-scenario {
    font-size: 0.8rem; font-weight: 600; color: var(--text-strong);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .cross-list-detail {
    font-size: 0.7rem; color: var(--text-muted);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }

  .cross-list-diff {
    font-size: 0.8rem; font-weight: 700; font-family: var(--font-mono, monospace);
    white-space: nowrap; flex-shrink: 0;
  }
  .cross-list-ssim {
    font-size: 0.7rem; color: var(--text-muted); font-family: var(--font-mono, monospace);
    white-space: nowrap; flex-shrink: 0;
  }

  /* Badge group for stacking multiple badges */
  .cross-badge-group {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 0.25rem;
  }

  /* Outdated badge/indicator */
  .cross-badge.tag-outdated { background: rgba(245, 158, 11, 0.12); border-color: rgba(245, 158, 11, 0.5); color: #f59e0b; }
  .tag-filter.tag-outdated { border-color: rgba(245, 158, 11, 0.45); background: rgba(245, 158, 11, 0.12); color: #f59e0b; }
  .cross-card.tag-outdated { border-color: rgba(245, 158, 11, 0.6); }

  .outdated-indicator { color: #f59e0b; font-weight: 600; }
  .ai-running { color: var(--accent); font-weight: 500; }

  /* AI recommendation badges */
  .cross-badge.tag-ai-approve { background: rgba(34, 197, 94, 0.12); border-color: rgba(34, 197, 94, 0.4); color: #22c55e; }
  .cross-badge.tag-ai-review { background: rgba(245, 158, 11, 0.12); border-color: rgba(245, 158, 11, 0.4); color: #f59e0b; }
  .cross-badge.tag-ai-reject { background: rgba(239, 68, 68, 0.12); border-color: rgba(239, 68, 68, 0.4); color: #ef4444; }

  /* AI filter tag styles */
  .tag-filter.tag-ai-approved { border-color: rgba(34, 197, 94, 0.4); background: rgba(34, 197, 94, 0.12); color: #22c55e; }
  .tag-filter.tag-ai-review { border-color: rgba(245, 158, 11, 0.45); background: rgba(245, 158, 11, 0.12); color: #f59e0b; }
  .tag-filter.tag-ai-rejected { border-color: rgba(239, 68, 68, 0.4); background: rgba(239, 68, 68, 0.12); color: #ef4444; }
</style>
