<script lang="ts">
  import type { GalleryImage } from './gallery-types.js';

  interface Props {
    isCompareMode: boolean;
    queue: GalleryImage[];
    currentImage?: GalleryImage;
    canAct: boolean;
    panicAvailable: boolean;
    panicActive: boolean;
    thumbnailsAvailable: boolean;
    thumbnailsActive: boolean;
    autoFitAvailable: boolean;
    autoFitActive: boolean;
    onTogglePanic?: () => void;
    onToggleThumbnails?: () => void;
    onToggleAutoFit?: () => void;
    onApprove?: (filename?: string) => void;
    onReject?: (filename?: string) => void;
    onRerun?: (filename: string) => void;
    testRunning: boolean;
    onAnalyze?: () => void;
    analyzing: boolean;
    isAccepted: boolean;
    onRevokeAcceptance?: () => void;
    onAcceptForBrowser?: () => void;
  }

  let {
    isCompareMode,
    queue,
    currentImage,
    canAct,
    panicAvailable,
    panicActive,
    thumbnailsAvailable,
    thumbnailsActive,
    autoFitAvailable,
    autoFitActive,
    onTogglePanic,
    onToggleThumbnails,
    onToggleAutoFit,
    onApprove,
    onReject,
    onRerun,
    testRunning,
    onAnalyze,
    analyzing,
    isAccepted,
    onRevokeAcceptance,
    onAcceptForBrowser,
  }: Props = $props();

  const queueCounts = $derived.by(() => {
    let failed = 0, newCount = 0, passed = 0;
    for (const i of queue) {
      if (i.status === 'failed') failed++;
      else if (i.status === 'new') newCount++;
      else if (i.status === 'passed') passed++;
    }
    return { failed, new: newCount, passed };
  });

  function handleApprove() {
    if (!currentImage) return;
    onApprove?.(currentImage.filename);
  }

  function handleReject() {
    if (!currentImage) return;
    onReject?.(currentImage.filename);
  }
</script>

<div class="gallery-footer">
  <div class="footer-left">
    <span class="hint">
      {#if !isCompareMode}
        <kbd>←</kbd><kbd>→</kbd> Navigate
      {/if}
      <kbd>1</kbd><kbd>2</kbd><kbd>3</kbd> Views
      <kbd>+</kbd><kbd>-</kbd> Zoom
      {#if isCompareMode}
        <kbd>A</kbd> Approve
        <kbd>U</kbd> Undo
      {/if}
      {#if thumbnailsAvailable}
        <button
          type="button"
          class="hint-toggle"
          class:active={thumbnailsActive}
          aria-pressed={thumbnailsActive}
          title="Toggle thumbnails (T)"
          onclick={() => onToggleThumbnails?.()}
        >
          <kbd>T</kbd> Thumbnails
        </button>
      {/if}
      {#if autoFitAvailable}
        <button
          type="button"
          class="hint-toggle"
          class:active={autoFitActive}
          aria-pressed={autoFitActive}
          title="Toggle auto-fit columns (F)"
          onclick={() => onToggleAutoFit?.()}
        >
          <kbd>F</kbd> Auto-fit
        </button>
      {/if}
      {#if panicAvailable}
        <button
          type="button"
          class="hint-toggle"
          class:active={panicActive}
          aria-pressed={panicActive}
          title="Toggle panic check (P)"
          onclick={() => onTogglePanic?.()}
        >
          <kbd>P</kbd> Panic
        </button>
      {/if}
    </span>
  </div>

  <div class="footer-center">
    {#if isCompareMode}
      {#if onAnalyze}
        <button class="action-btn ai" onclick={onAnalyze} disabled={analyzing}>
          {analyzing ? 'Analyzing...' : 'Analyze with AI'}
        </button>
      {/if}
      {#if isAccepted && onRevokeAcceptance}
        <button class="action-btn revoke" onclick={onRevokeAcceptance}>
          Revoke Acceptance
        </button>
        <span class="accepted-badge">Accepted</span>
      {:else if onAcceptForBrowser}
        <button class="action-btn accept" onclick={onAcceptForBrowser}>
          Accept for Browser
        </button>
      {/if}
    {:else if currentImage && onApprove && onReject}
      <button class="action-btn approve" onclick={handleApprove} disabled={!canAct}>
        {#if currentImage.status === 'new'}
          Approve as Baseline
        {:else}
          Approve Test
        {/if}
        <kbd>A</kbd>
      </button>
      <button class="action-btn reject" onclick={handleReject} disabled={!canAct}>
        Reject <kbd>R</kbd>
      </button>
      {#if onRerun}
        <button
          class="action-btn rerun"
          onclick={() => onRerun?.(currentImage.filename)}
          disabled={testRunning}
        >
          {testRunning ? 'Running...' : 'Rerun'}
        </button>
      {/if}
    {/if}
  </div>

  <div class="footer-right">
    {#if !isCompareMode}
      <span class="queue-info">
        {queueCounts.failed} failed, {queueCounts.new} new, {queueCounts.passed} passed
      </span>
    {/if}
  </div>
</div>

<style>
  .gallery-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 16px;
    background: var(--bg);
    border-top: 1px solid var(--border);
    font-family: var(--font-mono, 'JetBrains Mono', monospace);
  }

  .footer-left,
  .footer-right {
    flex: 1;
  }

  .footer-right {
    text-align: right;
  }

  .footer-center {
    display: flex;
    gap: 8px;
  }

  .hint {
    font-size: 11px;
    color: var(--text-muted);
  }

  .hint kbd {
    display: inline-block;
    padding: 1px 4px;
    margin: 0 2px;
    background: transparent;
    border: 1px solid var(--border);
    border-radius: 0;
    font-size: 9px;
    color: var(--text-muted);
  }

  .hint-toggle {
    margin: 0;
    padding: 2px 6px;
    border-radius: 0;
    border: 1px solid transparent;
    background: transparent;
    color: inherit;
    font: inherit;
    cursor: pointer;
  }

  .hint-toggle:hover {
    border-color: var(--border);
  }

  .hint-toggle.active {
    color: var(--accent, #10B981);
    border-color: var(--accent, #10B981);
    background: transparent;
    font-weight: 600;
  }

  .queue-info {
    font-size: 11px;
    color: var(--text-muted);
    white-space: nowrap;
  }

  .action-btn {
    padding: 6px 16px;
    border: 1px solid var(--border);
    border-radius: 0;
    font-family: var(--font-mono, monospace);
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s;
    text-transform: lowercase;
    background: transparent;
    color: var(--text-strong);
  }

  .action-btn kbd {
    display: inline-block;
    padding: 1px 4px;
    margin-left: 6px;
    background: rgba(255, 255, 255, 0.08);
    border: 1px solid var(--border);
    border-radius: 0;
    font-size: 9px;
  }

  .action-btn.approve {
    border-color: #22c55e;
    color: #22c55e;
  }

  .action-btn.approve:hover:not(:disabled) {
    background: #22c55e;
    color: var(--bg);
  }

  .action-btn.reject {
    border-color: #ef4444;
    color: #ef4444;
  }

  .action-btn.reject:hover:not(:disabled) {
    background: #ef4444;
    color: var(--bg);
  }

  .action-btn.rerun {
    border-color: var(--accent);
    color: var(--accent);
  }

  .action-btn.rerun:hover:not(:disabled) {
    background: var(--accent);
    color: var(--bg);
  }

  .action-btn.ai {
    border-color: #0ea5e9;
    color: #0ea5e9;
  }

  .action-btn.ai:hover:not(:disabled) {
    background: #0ea5e9;
    color: var(--bg);
  }

  .action-btn.accept {
    border-color: #22c55e;
    color: #22c55e;
  }

  .action-btn.accept:hover:not(:disabled) {
    background: #22c55e;
    color: var(--bg);
  }

  .action-btn.revoke {
    border-color: #ef4444;
    color: #ef4444;
  }

  .action-btn.revoke:hover:not(:disabled) {
    background: #ef4444;
    color: var(--bg);
  }

  .action-btn:disabled {
    opacity: 0.3;
    cursor: not-allowed;
  }

  .accepted-badge {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 5px 12px;
    background: transparent;
    border: 1px solid #22c55e;
    border-radius: 0;
    color: #22c55e;
    font-size: 11px;
    font-weight: 500;
  }

  .accepted-badge::before {
    content: '\2713';
  }
</style>
