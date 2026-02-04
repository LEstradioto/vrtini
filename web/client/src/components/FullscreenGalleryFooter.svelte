<script lang="ts">
  type ImageStatus = 'passed' | 'failed' | 'new';

  interface GalleryImage {
    filename: string;
    status: ImageStatus;
  }

  interface Props {
    isCompareMode: boolean;
    queue: GalleryImage[];
    currentImage?: GalleryImage;
    canAct: boolean;
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

  const queueCounts = $derived({
    failed: queue.filter((i) => i.status === 'failed').length,
    new: queue.filter((i) => i.status === 'new').length,
    passed: queue.filter((i) => i.status === 'passed').length,
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
      {#if !isCompareMode}
        <kbd>T</kbd> Thumbnails
      {:else}
        <kbd>A</kbd> Approve
        <kbd>U</kbd> Undo
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
    padding: 12px 20px;
    background: #1a1a2e;
    border-top: 1px solid var(--border);
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
    gap: 12px;
  }

  .hint {
    font-size: 12px;
    color: var(--text-muted);
  }

  .hint kbd {
    display: inline-block;
    padding: 2px 5px;
    margin: 0 2px;
    background: var(--border);
    border-radius: 3px;
    font-size: 10px;
    color: var(--text-muted);
  }

  .queue-info {
    font-size: 12px;
    color: var(--text-muted);
  }

  .action-btn {
    padding: 10px 24px;
    border: none;
    border-radius: 6px;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s;
  }

  .action-btn kbd {
    display: inline-block;
    padding: 2px 6px;
    margin-left: 8px;
    background: rgba(255, 255, 255, 0.2);
    border-radius: 3px;
    font-size: 11px;
  }

  .action-btn.approve {
    background: #22c55e;
    color: var(--text-strong);
  }

  .action-btn.approve:hover:not(:disabled) {
    background: #16a34a;
  }

  .action-btn.reject {
    background: #ef4444;
    color: var(--text-strong);
  }

  .action-btn.reject:hover:not(:disabled) {
    background: #dc2626;
  }

  .action-btn.rerun {
    background: var(--border);
    border: 1px solid var(--accent);
    color: var(--accent);
  }

  .action-btn.rerun:hover:not(:disabled) {
    background: var(--accent);
    color: var(--text-strong);
  }

  .action-btn.ai {
    background: #0ea5e9;
    color: var(--text-strong);
  }

  .action-btn.ai:hover:not(:disabled) {
    background: #0284c7;
  }

  .action-btn.accept {
    background: #16a34a;
    color: var(--text-strong);
  }

  .action-btn.accept:hover:not(:disabled) {
    background: #15803d;
  }

  .action-btn.revoke {
    background: transparent;
    border: 1px solid #ef4444;
    color: #ef4444;
  }

  .action-btn.revoke:hover:not(:disabled) {
    background: #ef4444;
    color: var(--text-strong);
  }

  .action-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .accepted-badge {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 8px 14px;
    background: rgba(34, 197, 94, 0.1);
    border: 1px solid #22c55e;
    border-radius: 6px;
    color: #22c55e;
    font-size: 13px;
    font-weight: 500;
  }

  .accepted-badge::before {
    content: '\2713';
  }
</style>
