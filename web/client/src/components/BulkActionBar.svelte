<script lang="ts">
  let {
    selectedCount,
    selectedApprovableCount,
    selectedRejectableCount,
    bulkOperating,
    bulkProgress,
    bulkTotal,
    onApprove,
    onReject,
    onDelete,
    onCancel,
  } = $props<{
    selectedCount: number;
    selectedApprovableCount: number;
    selectedRejectableCount: number;
    bulkOperating: boolean;
    bulkProgress: number;
    bulkTotal: number;
    onApprove: () => void;
    onReject: () => void;
    onDelete: () => void;
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
    {#if selectedApprovableCount > 0}
      <button class="btn primary" onclick={onApprove} disabled={bulkOperating}>
        Approve All ({selectedApprovableCount})
      </button>
    {/if}
    {#if selectedRejectableCount > 0}
      <button class="btn danger" onclick={onReject} disabled={bulkOperating}>
        Reject All ({selectedRejectableCount})
      </button>
    {/if}
    <button class="btn danger" onclick={onDelete} disabled={bulkOperating}>Delete Selected</button>
    <button class="btn" onclick={onCancel} disabled={bulkOperating}>Cancel</button>
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

  .bulk-action-bar.operating { background: #252525; }

  .bulk-info { display: flex; align-items: center; gap: 1rem; }
  .bulk-count { font-size: 1rem; font-weight: 600; color: var(--text-strong); }
  .bulk-progress { font-size: 0.875rem; color: var(--accent); }
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
  }
  .btn:hover { background: var(--border-soft); }
  .btn.primary { background: var(--accent); color: #fff; }
  .btn.primary:hover { background: var(--accent-strong); }
  .btn.danger { background: #7f1d1d; color: #fff; }
  .btn.danger:hover { background: #ef4444; }
</style>
