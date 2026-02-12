<script lang="ts">
  import {
    crossCompare,
    test,
    type CrossResultItem,
    type CrossResults,
    type CrossResultsSummary,
  } from '../lib/api';
  import { getErrorMessage } from '../lib/errors';
  import { CROSS_PAGE_SIZE } from '../../../shared/constants';

  type CrossStatusFilter = 'all' | 'diffs' | 'matches' | 'smart' | 'approved' | 'unapproved';
  type CrossPairFilterValue = 'all' | 'diffs' | 'issues' | 'smart' | 'approved' | 'matches';

  type CrossPrefs = {
    searchQuery?: string;
    statusFilter?: CrossStatusFilter[];
    pairFilter?: CrossPairFilterValue;
    hideApproved?: boolean;
    selectedKey?: string | null;
  };
  const CROSS_STATUS_VALUES: CrossStatusFilter[] = [
    'all', 'diffs', 'matches', 'smart', 'approved', 'unapproved',
  ];
  const CROSS_PAIR_VALUES = new Set<CrossPairFilterValue>([
    'all', 'diffs', 'issues', 'smart', 'approved', 'matches',
  ]);

  let {
    projectId,
    crossReports = $bindable(),
    getFileUrl,
    getFileThumbUrl,
    onOpenCrossCompare,
    onSetActiveTab,
  } = $props<{
    projectId: string;
    crossReports: CrossResultsSummary[];
    getFileUrl: (relativePath: string) => string;
    getFileThumbUrl: (relativePath: string) => string;
    onOpenCrossCompare: (item: CrossResultItem, index: number, filteredItems: CrossResultItem[], results: CrossResults) => void;
    onSetActiveTab: (tab: string) => void;
  }>();

  // Cross-compare state
  let crossCompareRunning = $state(false);
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
  let crossPairFilter = $state<CrossPairFilterValue>('all');
  let crossHideApproved = $state(false);
  let crossCurrentPage = $state(0);
  let crossPrefsLoaded = $state(false);
  let crossPrefsApplying = $state(false);
  let selectedCrossItems = $state<Set<string>>(new Set());

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
      pairFilter: crossPairFilter,
      hideApproved: crossHideApproved,
      selectedKey: selectedCrossKey ?? null,
    };
    localStorage.setItem(getCrossPrefsKey(), JSON.stringify(payload));
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
    if (prefs.pairFilter && CROSS_PAIR_VALUES.has(prefs.pairFilter)) {
      crossPairFilter = prefs.pairFilter;
    }

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
    try {
      await crossCompare.run(projectId, options);
      const list = await crossCompare.list(projectId);
      crossReports = list.results;
      const nextKey = options?.key ?? crossReports[0]?.key ?? null;
      if (nextKey) {
        selectedCrossKey = nextKey;
        await loadCrossResults(nextKey);
        onSetActiveTab('cross');
      }
    } catch (err) {
      crossCompareError = getErrorMessage(err, 'Cross compare failed');
    } finally {
      crossCompareRunning = false;
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
    if (!confirm(`Delete cross compare results for "${selectedCrossKey}"? This will remove reports, diffs, and approvals.`)) {
      return;
    }

    crossResultsError = null;
    try {
      await crossCompare.clear(projectId, selectedCrossKey);
      const list = await crossCompare.list(projectId);
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
    if (key) {
      await loadCrossResults(key);
    }
  }

  async function approveCrossItem(item: CrossResultItem) {
    if (!selectedCrossKey || !item.itemKey) return;
    try {
      await crossCompare.accept(projectId, selectedCrossKey, item.itemKey);
      await loadCrossResults(selectedCrossKey);
      await refreshCrossReports();
    } catch (err) {
      crossResultsError = getErrorMessage(err, 'Failed to approve cross item');
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

  // Filter logic
  function matchesCrossStatus(item: CrossResultItem, status: CrossStatusFilter): boolean {
    switch (status) {
      case 'diffs': return !item.match;
      case 'matches': return item.match;
      case 'smart': return item.match && item.diffPercentage > 0;
      case 'approved': return !!item.accepted;
      case 'unapproved': return !item.accepted;
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
    const smart = report.smartPassCount ?? 0;
    const match = report.matchCount ?? 0;
    const diff = report.diffCount ?? 0;
    const issue = report.issueCount ?? 0;
    return `A ${approved} · S ${smart} · M ${match} · D ${diff} · I ${issue}`;
  }

  // Derived state
  let filteredCrossReports = $derived.by(() => {
    if (crossPairFilter === 'all') return crossReports;
    return crossReports.filter((report) => {
      switch (crossPairFilter) {
        case 'diffs': return (report.diffCount ?? 0) > 0;
        case 'issues': return (report.issueCount ?? 0) > 0;
        case 'smart': return (report.smartPassCount ?? 0) > 0;
        case 'approved': return (report.approvedCount ?? 0) > 0;
        case 'matches': return (report.matchCount ?? 0) + (report.smartPassCount ?? 0) > 0;
        default: return true;
      }
    });
  });

  let crossPairCounts = $derived.by(() => {
    const counts = { all: crossReports.length, diffs: 0, issues: 0, smart: 0, approved: 0, matches: 0 };
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

  let crossTotalPages = $derived(Math.ceil(crossFilteredItems.length / CROSS_PAGE_SIZE));
  let crossCurrentList = $derived(
    crossFilteredItems.slice(crossCurrentPage * CROSS_PAGE_SIZE, (crossCurrentPage + 1) * CROSS_PAGE_SIZE)
  );

  let crossPairSummary = $derived.by(() => {
    if (!crossResults) return null;
    const summary = { total: 0, approved: 0, smart: 0, match: 0, diff: 0, issue: 0 };
    for (const item of crossResults.items) {
      summary.total += 1;
      if (item.accepted) { summary.approved += 1; continue; }
      const smartPass = item.match && item.diffPercentage > 0;
      if (item.match) { if (smartPass) summary.smart += 1; else summary.match += 1; continue; }
      if (item.reason === 'diff') summary.diff += 1; else summary.issue += 1;
    }
    return summary;
  });

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
    crossSearchQuery; crossStatusFilter; crossPairFilter; crossHideApproved; selectedCrossKey;
    saveCrossPrefs();
  });

  $effect(() => {
    const maxPage = Math.max(0, crossTotalPages - 1);
    if (crossCurrentPage > maxPage) crossCurrentPage = maxPage;
  });

  $effect(() => {
    if (filteredCrossReports.length === 0) {
      if (selectedCrossKey) { selectedCrossKey = null; crossResults = null; }
      return;
    }
    const stillSelected = filteredCrossReports.some((report) => report.key === selectedCrossKey);
    if (!stillSelected) {
      selectedCrossKey = filteredCrossReports[0].key;
      loadCrossResults(selectedCrossKey);
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
    if (selectedCrossKey) {
      loadCrossResults(selectedCrossKey);
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
    };
  }

  /** Called from parent after approve/revoke in fullscreen modal */
  export async function approveCrossFromModal(item: CrossResultItem) {
    await approveCrossItem(item);
  }

  export async function revokeCrossFromModal(item: CrossResultItem) {
    await revokeCrossItem(item);
  }
</script>

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
    <button class="btn" onclick={() => runCrossCompare()} disabled={crossCompareRunning}>
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
        <button class="tag-filter tag-all" class:active={crossPairFilter === 'all'} onclick={() => crossPairFilter = 'all'} title="Show all cross-compare pairs">All ({crossPairCounts.all})</button>
        <button class="tag-filter tag-diff" class:active={crossPairFilter === 'diffs'} onclick={() => crossPairFilter = 'diffs'} title="Pairs with at least one diff">Diffs ({crossPairCounts.diffs})</button>
        <button class="tag-filter tag-unapproved" class:active={crossPairFilter === 'issues'} onclick={() => crossPairFilter = 'issues'} title="Pairs with issues (errors, missing images)">Issues ({crossPairCounts.issues})</button>
        <button class="tag-filter tag-smart" class:active={crossPairFilter === 'smart'} onclick={() => crossPairFilter = 'smart'} title="Pairs with smart-pass items">Smart Pass ({crossPairCounts.smart})</button>
        <button class="tag-filter tag-approved" class:active={crossPairFilter === 'approved'} onclick={() => crossPairFilter = 'approved'} title="Pairs with approved items">Approved ({crossPairCounts.approved})</button>
        <button class="tag-filter tag-passed" class:active={crossPairFilter === 'matches'} onclick={() => crossPairFilter = 'matches'} title="Pairs with matches (including smart pass)">Matches ({crossPairCounts.matches})</button>
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
      <button class="tag-filter tag-unapproved" class:active={isCrossStatusActive('unapproved')} onclick={(event) => toggleCrossStatusFilter('unapproved', event)} title="Items not yet approved">Unapproved</button>
      <button class="tag-filter" class:active={crossHideApproved} onclick={() => crossHideApproved = !crossHideApproved} title="Hide approved items from results">Hide Approved</button>
    </div>
    <div class="cross-selection-controls">
      {#if selectedCrossCount > 0}
        <span class="selected-count">{selectedCrossCount} selected</span>
        <button class="btn small rerun" onclick={rerunSelectedCrossItems} disabled={crossCompareRunning || crossTestRunning}>
          {crossCompareRunning ? 'Running...' : `Rerun Compare (${selectedCrossCount})`}
        </button>
        <button class="btn small rerun-tests" onclick={rerunSelectedCrossItemTests} disabled={crossCompareRunning || crossTestRunning}>
          {crossTestRunning ? 'Rerunning...' : `Rerun Tests (${selectedCrossCount})`}
        </button>
      {:else}
        <button
          class="btn small rerun"
          onclick={rerunFilteredCrossItems}
          disabled={crossFilteredItems.length === 0 || crossCompareRunning || crossTestRunning}
        >
          {crossCompareRunning ? 'Running...' : `Rerun Compare Filtered (${crossFilteredItems.length})`}
        </button>
        <button
          class="btn small rerun-tests"
          onclick={rerunFilteredCrossItemTests}
          disabled={crossFilteredItems.length === 0 || crossCompareRunning || crossTestRunning}
        >
          {crossTestRunning ? 'Rerunning...' : `Rerun Tests Filtered (${crossFilteredItems.length})`}
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
      <button class="btn small" onclick={deselectAllCross} disabled={selectedCrossCount === 0}>Deselect</button>
      <button class="btn small danger" onclick={deleteCrossItems} disabled={selectedCrossCount === 0}>Delete Selected</button>
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

  {#if crossResultsLoading}
    <div class="compare-hint">Loading cross compare results...</div>
  {:else if crossReports.length > 0 && filteredCrossReports.length === 0}
    <div class="compare-hint">No cross-compare pairs match your filter.</div>
  {:else if crossResults}
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
      {:else}
        Pair: {crossResults.baselineLabel} vs {crossResults.testLabel}
        · Generated: {new Date(crossResults.generatedAt).toLocaleString()}
        {#if crossTestRunning && crossTestJob}
          · Rerunning tests: {crossTestJob.progress} / {crossTestJob.total}
        {/if}
        · Items: {crossFilteredItems.length}
      {/if}
    </div>

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
      <div class="cross-grid">
        {#each crossCurrentList as item}
          {@const smartPass = item.match && item.diffPercentage > 0}
          {@const crossTag = item.accepted ? 'approved' : item.match ? smartPass ? 'smart' : 'passed' : item.reason === 'diff' ? 'diff' : 'unapproved'}
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
    {/if}
  {:else}
    <div class="compare-hint">
      Run cross compare to generate results for browser pairs.
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
    font-size: 0.9rem;
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
  .cross-badge.tag-smart { background: rgba(20, 184, 166, 0.12); border-color: rgba(20, 184, 166, 0.4); color: var(--tag-smart); }
  .cross-badge.tag-unapproved { background: rgba(239, 68, 68, 0.12); border-color: rgba(239, 68, 68, 0.4); color: var(--tag-unapproved); }
  .cross-badge.tag-new { background: rgba(245, 158, 11, 0.12); border-color: rgba(245, 158, 11, 0.45); color: var(--tag-new); }
  .cross-badge.tag-diff { background: rgba(249, 115, 22, 0.12); border-color: rgba(249, 115, 22, 0.45); color: var(--tag-diff); }
  .cross-badge.tag-passed { background: rgba(56, 189, 248, 0.12); border-color: rgba(56, 189, 248, 0.45); color: var(--tag-passed); }

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
    opacity: 0.55;
    transition: opacity 0.15s, border-color 0.15s, color 0.15s, background 0.15s;
  }
  .tag-filter.active { opacity: 1; color: var(--text-strong); }
  .tag-filter.tag-approved { border-color: rgba(34, 197, 94, 0.4); background: rgba(34, 197, 94, 0.12); color: var(--tag-approved); }
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
</style>
