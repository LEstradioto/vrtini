<script lang="ts">
  let {
    selectedCount,
    selectedApprovableCount = 0,
    selectedRejectableCount = 0,
    bulkOperating = false,
    bulkProgress = 0,
    bulkTotal = 0,
    mode = 'standard',
    crossRunning = false,
    onApprove,
    onReject,
    onDelete,
    onRerun,
    onRerunTests,
    onAITriage,
    aiTriageRunning = false,
    onSelectAll,
    onCancel,
  } = $props<{
    selectedCount: number;
    selectedApprovableCount?: number;
    selectedRejectableCount?: number;
    bulkOperating?: boolean;
    bulkProgress?: number;
    bulkTotal?: number;
    mode?: 'standard' | 'cross';
    crossRunning?: boolean;
    onApprove?: () => void;
    onReject?: () => void;
    onDelete?: () => void;
    onRerun?: () => void;
    onRerunTests?: () => void;
    onAITriage?: () => void;
    aiTriageRunning?: boolean;
    onSelectAll?: () => void;
    onCancel: () => void;
  }>();
</script>

<div class="bulk-action-bar" class:operating={bulkOperating}>
  <div class="bulk-info">
    <span class="bulk-count">{selectedCount} selected</span>
    {#if bulkOperating}
      <span class="bulk-progress">Processing {bulkProgress}/{bulkTotal}...</span>
    {/if}
  </div>
  <div class="bulk-actions">
    {#if mode === 'cross'}
      {#if onApprove}
        <button class="btn primary" onclick={onApprove} disabled={crossRunning}>Approve ({selectedCount})</button>
      {/if}
      {#if onRerun}
        <button class="btn accent" onclick={onRerun} disabled={crossRunning}>
          {crossRunning ? 'Running...' : `Rerun Compare (${selectedCount})`}
        </button>
      {/if}
      {#if onRerunTests}
        <button class="btn warning" onclick={onRerunTests} disabled={crossRunning}>
          {crossRunning ? 'Running...' : `Rerun Tests (${selectedCount})`}
        </button>
      {/if}
      {#if onAITriage}
        <button class="btn ai-triage" onclick={onAITriage} disabled={crossRunning || aiTriageRunning}>
          {aiTriageRunning ? 'AI Triaging...' : `AI Triage (${selectedCount})`}
        </button>
      {/if}
      {#if onDelete}
        <button class="btn danger" onclick={onDelete} disabled={crossRunning}>Delete ({selectedCount})</button>
      {/if}
    {:else}
      {#if onApprove && selectedApprovableCount > 0}
        <button class="btn primary" onclick={onApprove} disabled={bulkOperating}>
          Approve ({selectedApprovableCount})
        </button>
      {/if}
      {#if onReject && selectedRejectableCount > 0}
        <button class="btn danger" onclick={onReject} disabled={bulkOperating}>
          Reject ({selectedRejectableCount})
        </button>
      {/if}
      {#if onRerun}
        <button class="btn accent" onclick={onRerun} disabled={bulkOperating}>
          Rerun ({selectedCount})
        </button>
      {/if}
      {#if onAITriage}
        <button class="btn ai-triage" onclick={onAITriage} disabled={bulkOperating || aiTriageRunning}>
          {aiTriageRunning ? 'AI Triaging...' : `AI Triage (${selectedCount})`}
        </button>
      {/if}
      {#if onDelete}
        <button class="btn danger" onclick={onDelete} disabled={bulkOperating}>Delete ({selectedCount})</button>
      {/if}
    {/if}
    {#if onSelectAll}
      <button class="btn" onclick={onSelectAll}>Select All</button>
    {/if}
    <button class="btn" onclick={onCancel} disabled={bulkOperating}>Deselect</button>
  </div>
</div>

<style>
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
    from { transform: translateY(100%); opacity: 0; }
    to { transform: translateY(0); opacity: 1; }
  }

  .bulk-action-bar.operating { background: var(--panel-strong); }

  .bulk-info { display: flex; align-items: center; gap: 1rem; }
  .bulk-count { font-size: 1rem; font-weight: 600; color: var(--text-strong); font-family: var(--font-mono, monospace); }
  .bulk-progress { font-size: 0.875rem; color: var(--accent); font-family: var(--font-mono, monospace); }
  .bulk-actions { display: flex; gap: 0.75rem; }

  .btn {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 1rem;
    border: none;
    border-radius: 0;
    background: var(--border);
    color: var(--text-strong);
    font-family: var(--font-mono, monospace);
    font-size: 0.875rem;
    cursor: pointer;
    transition: background 0.2s;
    text-transform: lowercase;
  }
  .btn:hover { background: var(--border-soft); }
  .btn:disabled { opacity: 0.4; cursor: not-allowed; }
  .btn.primary { background: var(--accent); color: #fff; }
  .btn.primary:hover { background: var(--accent-strong); }
  .btn.accent { background: transparent; border: 1px solid var(--accent); color: var(--accent); }
  .btn.accent:hover:not(:disabled) { background: var(--accent); color: #fff; }
  .btn.warning { background: transparent; border: 1px solid #f59e0b; color: #f59e0b; }
  .btn.warning:hover:not(:disabled) { background: #f59e0b; color: var(--bg); }
  .btn.danger { background: #7f1d1d; color: #fff; }
  .btn.danger:hover { background: #ef4444; }
  .btn.ai-triage { background: transparent; border: 1px solid #a78bfa; color: #a78bfa; }
  .btn.ai-triage:hover:not(:disabled) { background: #a78bfa; color: var(--bg); }
</style>
