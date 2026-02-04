<script lang="ts">
  import type { ImageMetadata, Acceptance, AIAnalysisResult } from '../lib/api';

  interface ComparisonRow {
    filename: string;
    metadata: ImageMetadata;
    diffPercentage?: number;
    ssimScore?: number;
    status: 'match' | 'flagged' | 'accepted';
    acceptance?: Acceptance;
    aiAnalysis?: AIAnalysisResult;
  }

  interface Props {
    rows: ComparisonRow[];
    onAnalyze: (filenames: string[]) => void;
    onAccept: (filename: string) => void;
    onRevoke: (filename: string) => void;
    analyzing: boolean;
  }

  let { rows, onAnalyze, onAccept, onRevoke, analyzing } = $props<Props>();

  // Selection state
  let selectedRows = $state<Set<string>>(new Set());
  let searchQuery = $state('');
  let statusFilter = $state<'all' | 'match' | 'flagged' | 'accepted'>('all');
  let browserFilter = $state<string>('');

  // Get unique browsers for filter
  let uniqueBrowsers = $derived(() => {
    const browsers = new Set<string>();
    for (const row of rows) {
      const browser = row.metadata.version
        ? `${row.metadata.browser} v${row.metadata.version}`
        : row.metadata.browser;
      browsers.add(browser);
    }
    return Array.from(browsers).sort();
  });

  // Filter rows
  let filteredRows = $derived(() => {
    return rows.filter((row) => {
      // Search filter
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesSearch =
          row.filename.toLowerCase().includes(q) ||
          row.metadata.scenario.toLowerCase().includes(q) ||
          row.metadata.browser.toLowerCase().includes(q) ||
          row.metadata.viewport.toLowerCase().includes(q);
        if (!matchesSearch) return false;
      }

      // Status filter
      if (statusFilter !== 'all' && row.status !== statusFilter) {
        return false;
      }

      // Browser filter
      if (browserFilter) {
        const rowBrowser = row.metadata.version
          ? `${row.metadata.browser} v${row.metadata.version}`
          : row.metadata.browser;
        if (rowBrowser !== browserFilter) return false;
      }

      return true;
    });
  });

  // Selection helpers
  let allSelected = $derived(
    filteredRows.length > 0 && filteredRows.every((r) => selectedRows.has(r.filename))
  );

  function toggleSelectAll() {
    if (allSelected) {
      selectedRows = new Set();
    } else {
      selectedRows = new Set(filteredRows.map((r) => r.filename));
    }
  }

  function toggleRow(filename: string) {
    const newSet = new Set(selectedRows);
    if (newSet.has(filename)) {
      newSet.delete(filename);
    } else {
      newSet.add(filename);
    }
    selectedRows = newSet;
  }

  function handleBatchAnalyze() {
    const selected = Array.from(selectedRows);
    if (selected.length > 0) {
      onAnalyze(selected);
    }
  }

  function getStatusColor(status: string): string {
    switch (status) {
      case 'match':
        return '#22c55e';
      case 'accepted':
        return '#3b82f6';
      case 'flagged':
        return '#f59e0b';
      default:
        return '#888';
    }
  }

  function getSeverityColor(severity: string): string {
    switch (severity) {
      case 'critical':
        return '#ef4444';
      case 'warning':
        return '#f59e0b';
      case 'info':
        return '#3b82f6';
      default:
        return '#888';
    }
  }

  function formatBrowser(meta: ImageMetadata): string {
    if (meta.version) {
      return `${meta.browser} v${meta.version}`;
    }
    return meta.browser;
  }
</script>

<div class="comparison-table">
  <div class="table-toolbar">
    <div class="toolbar-left">
      <input
        type="text"
        class="search-input"
        placeholder="Search images..."
        bind:value={searchQuery}
      />
      <select class="filter-select" bind:value={statusFilter}>
        <option value="all">All Status</option>
        <option value="match">Match</option>
        <option value="flagged">Flagged</option>
        <option value="accepted">Accepted</option>
      </select>
      <select class="filter-select" bind:value={browserFilter}>
        <option value="">All Browsers</option>
        {#each uniqueBrowsers as browser}
          <option value={browser}>{browser}</option>
        {/each}
      </select>
    </div>
    <div class="toolbar-right">
      {#if selectedRows.size > 0}
        <span class="selection-count">{selectedRows.size} selected</span>
        <button
          class="btn primary small"
          onclick={handleBatchAnalyze}
          disabled={analyzing}
        >
          {analyzing ? 'Analyzing...' : `Batch AI (${selectedRows.size})`}
        </button>
      {/if}
    </div>
  </div>

  <div class="table-container">
    <table>
      <thead>
        <tr>
          <th class="checkbox-col">
            <input
              type="checkbox"
              checked={allSelected}
              onchange={toggleSelectAll}
            />
          </th>
          <th class="image-col">Image</th>
          <th class="diff-col">Diff %</th>
          <th class="ssim-col">SSIM</th>
          <th class="status-col">Status</th>
          <th class="actions-col">Actions</th>
        </tr>
      </thead>
      <tbody>
        {#each filteredRows as row (row.filename)}
          <tr class:selected={selectedRows.has(row.filename)}>
            <td class="checkbox-col">
              <input
                type="checkbox"
                checked={selectedRows.has(row.filename)}
                onchange={() => toggleRow(row.filename)}
              />
            </td>
            <td class="image-col">
              <div class="image-info">
                <span class="image-name">{row.metadata.scenario}</span>
                <span class="image-meta">
                  {formatBrowser(row.metadata)} / {row.metadata.viewport}
                </span>
              </div>
            </td>
            <td class="diff-col">
              {#if row.diffPercentage !== undefined}
                <span class="diff-value" class:high={row.diffPercentage > 1}>
                  {row.diffPercentage.toFixed(2)}%
                </span>
              {:else}
                <span class="no-value">-</span>
              {/if}
            </td>
            <td class="ssim-col">
              {#if row.ssimScore !== undefined}
                <span class="ssim-value" class:low={row.ssimScore < 0.95}>
                  {(row.ssimScore * 100).toFixed(1)}%
                </span>
              {:else}
                <span class="no-value">-</span>
              {/if}
            </td>
            <td class="status-col">
              <span class="status-badge" style="--status-color: {getStatusColor(row.status)}">
                {#if row.status === 'accepted'}
                  <span class="check-icon">&#10003;</span>
                {/if}
                {row.status}
              </span>
              {#if row.aiAnalysis}
                <span
                  class="ai-badge"
                  style="--severity-color: {getSeverityColor(row.aiAnalysis.severity)}"
                  title={row.aiAnalysis.summary}
                >
                  {row.aiAnalysis.category}
                </span>
              {/if}
            </td>
            <td class="actions-col">
              <div class="action-buttons">
                <button
                  class="action-btn ai"
                  onclick={() => onAnalyze([row.filename])}
                  disabled={analyzing}
                  title="Analyze with AI"
                >
                  AI
                </button>
                {#if row.status === 'accepted'}
                  <button
                    class="action-btn revoke"
                    onclick={() => onRevoke(row.filename)}
                    title="Revoke acceptance"
                  >
                    Revoke
                  </button>
                {:else}
                  <button
                    class="action-btn accept"
                    onclick={() => onAccept(row.filename)}
                    title="Accept for this browser"
                  >
                    Accept
                  </button>
                {/if}
              </div>
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>

  {#if filteredRows.length === 0}
    <div class="empty-state">
      {#if searchQuery || statusFilter !== 'all' || browserFilter}
        No images match the current filters
      {:else}
        No comparison results yet
      {/if}
    </div>
  {/if}
</div>

<style>
  .comparison-table {
    display: flex;
    flex-direction: column;
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 8px;
    overflow: hidden;
  }

  .table-toolbar {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.75rem;
    background: var(--bg);
    border-bottom: 1px solid var(--border);
    gap: 1rem;
  }

  .toolbar-left {
    display: flex;
    gap: 0.5rem;
    flex: 1;
  }

  .toolbar-right {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .selection-count {
    font-size: 0.8rem;
    color: var(--text-muted);
  }

  .search-input {
    flex: 1;
    max-width: 300px;
    padding: 0.5rem 0.75rem;
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--text-strong);
    font-size: 0.875rem;
  }

  .search-input:focus {
    outline: none;
    border-color: var(--accent);
  }

  .search-input::placeholder {
    color: var(--text-muted);
  }

  .filter-select {
    padding: 0.5rem 0.75rem;
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--text-strong);
    font-size: 0.8rem;
    cursor: pointer;
  }

  .filter-select:focus {
    outline: none;
    border-color: var(--accent);
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

  .btn:hover:not(:disabled) {
    background: var(--border-soft);
  }

  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .btn.primary {
    background: var(--accent);
    color: #fff;
  }

  .btn.primary:hover:not(:disabled) {
    background: var(--accent-strong);
  }

  .btn.small {
    padding: 0.375rem 0.75rem;
    font-size: 0.8rem;
  }

  .table-container {
    overflow-x: auto;
  }

  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.875rem;
  }

  th, td {
    padding: 0.75rem;
    text-align: left;
    border-bottom: 1px solid var(--border);
  }

  th {
    background: var(--bg);
    color: var(--text-muted);
    font-weight: 500;
    text-transform: uppercase;
    font-size: 0.75rem;
    position: sticky;
    top: 0;
    z-index: 1;
  }

  tbody tr {
    transition: background 0.1s;
  }

  tbody tr:hover {
    background: var(--panel-soft);
  }

  tbody tr.selected {
    background: rgba(99, 102, 241, 0.1);
  }

  .checkbox-col {
    width: 40px;
    text-align: center;
  }

  .checkbox-col input {
    cursor: pointer;
  }

  .image-col {
    min-width: 200px;
  }

  .image-info {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .image-name {
    font-weight: 500;
    color: var(--text-strong);
  }

  .image-meta {
    font-size: 0.75rem;
    color: var(--text-muted);
  }

  .diff-col, .ssim-col {
    width: 80px;
    text-align: center;
  }

  .diff-value, .ssim-value {
    font-family: monospace;
    font-size: 0.8rem;
  }

  .diff-value.high {
    color: #f59e0b;
  }

  .ssim-value.low {
    color: #f59e0b;
  }

  .no-value {
    color: var(--text-muted);
  }

  .status-col {
    width: 140px;
  }

  .status-badge {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    padding: 0.25rem 0.5rem;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid var(--status-color);
    border-radius: 4px;
    color: var(--status-color);
    font-size: 0.75rem;
    text-transform: uppercase;
  }

  .check-icon {
    font-size: 0.7rem;
  }

  .ai-badge {
    display: inline-block;
    margin-left: 0.5rem;
    padding: 0.2rem 0.4rem;
    background: var(--severity-color);
    border-radius: 3px;
    color: var(--text-strong);
    font-size: 0.65rem;
    font-weight: 600;
    text-transform: uppercase;
  }

  .actions-col {
    width: 140px;
  }

  .action-buttons {
    display: flex;
    gap: 0.375rem;
  }

  .action-btn {
    padding: 0.25rem 0.5rem;
    border: 1px solid var(--border-soft);
    border-radius: 4px;
    background: transparent;
    color: var(--text-muted);
    font-size: 0.75rem;
    cursor: pointer;
    transition: all 0.15s;
  }

  .action-btn:hover:not(:disabled) {
    border-color: var(--text-muted);
    color: var(--text-strong);
  }

  .action-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .action-btn.ai {
    border-color: var(--accent);
    color: var(--accent);
  }

  .action-btn.ai:hover:not(:disabled) {
    background: var(--accent);
    color: var(--text-strong);
  }

  .action-btn.accept {
    border-color: #22c55e;
    color: #22c55e;
  }

  .action-btn.accept:hover:not(:disabled) {
    background: #22c55e;
    color: var(--text-strong);
  }

  .action-btn.revoke {
    border-color: #ef4444;
    color: #ef4444;
  }

  .action-btn.revoke:hover:not(:disabled) {
    background: #ef4444;
    color: var(--text-strong);
  }

  .empty-state {
    padding: 3rem;
    text-align: center;
    color: var(--text-muted);
  }
</style>
