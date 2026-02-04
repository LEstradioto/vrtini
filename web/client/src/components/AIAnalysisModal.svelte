<script lang="ts">
  import type { AIAnalysisResult } from '../lib/api';

  interface AnalysisItem {
    filename: string;
    analysis?: AIAnalysisResult;
    error?: string;
  }

  interface Props {
    results: AnalysisItem[];
    onClose: () => void;
    onAccept: (filename: string) => void;
  }

  let { results, onClose, onAccept } = $props<Props>();

  let currentIndex = $state(0);

  let currentResult = $derived(results[currentIndex]);
  let hasMultiple = $derived(results.length > 1);

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

  function getCategoryColor(category: string): string {
    switch (category) {
      case 'regression':
        return '#ef4444';
      case 'cosmetic':
        return '#3b82f6';
      case 'content_change':
        return '#f59e0b';
      case 'layout_shift':
        return '#a855f7';
      case 'noise':
        return '#6b7280';
      default:
        return '#888';
    }
  }

  function getRecommendationColor(recommendation: string): string {
    switch (recommendation) {
      case 'approve':
        return '#22c55e';
      case 'review':
        return '#f59e0b';
      case 'reject':
        return '#ef4444';
      default:
        return '#888';
    }
  }

  function formatCategory(category: string): string {
    return category.replace(/_/g, ' ');
  }

  function handleAction(action: 'accept' | 'reject') {
    if (!currentResult) return;

    if (action === 'accept') {
      onAccept(currentResult.filename);
    }

    // Move to next or close
    if (hasMultiple && currentIndex < results.length - 1) {
      currentIndex++;
    } else {
      onClose();
    }
  }

  function goNext() {
    if (currentIndex < results.length - 1) {
      currentIndex++;
    }
  }

  function goPrev() {
    if (currentIndex > 0) {
      currentIndex--;
    }
  }

  // Close on escape
  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      onClose();
    } else if (e.key === 'ArrowRight' && hasMultiple) {
      goNext();
    } else if (e.key === 'ArrowLeft' && hasMultiple) {
      goPrev();
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<div
  class="modal-backdrop"
  onclick={onClose}
  onkeydown={(e) => e.key === 'Enter' && onClose()}
  role="dialog"
  aria-modal="true"
  tabindex="-1"
>
  <div
    class="modal-content"
    onclick={(e) => e.stopPropagation()}
    onkeydown={(e) => e.stopPropagation()}
    role="document"
  >
    <div class="modal-header">
      <div class="header-title">
        <h2>AI Analysis</h2>
        {#if hasMultiple}
          <span class="result-counter">{currentIndex + 1} of {results.length}</span>
        {/if}
      </div>
      <button class="close-btn" onclick={onClose}>×</button>
    </div>

    {#if currentResult}
      <div class="modal-body">
        <div class="filename-row">
          <span class="filename">{currentResult.filename}</span>
        </div>

        {#if currentResult.error}
          <div class="error-message">
            <span class="error-icon">!</span>
            <span>{currentResult.error}</span>
          </div>
        {:else if currentResult.analysis}
          {@const analysis = currentResult.analysis}

          <div class="analysis-grid">
            <div class="analysis-item">
              <span class="item-label">Category</span>
              <span
                class="item-value badge"
                style="--badge-color: {getCategoryColor(analysis.category)}"
              >
                {formatCategory(analysis.category)}
              </span>
            </div>

            <div class="analysis-item">
              <span class="item-label">Severity</span>
              <span
                class="item-value badge"
                style="--badge-color: {getSeverityColor(analysis.severity)}"
              >
                {analysis.severity}
              </span>
            </div>

            <div class="analysis-item">
              <span class="item-label">Confidence</span>
              <span class="item-value">
                <span class="confidence-bar">
                  <span class="confidence-fill" style="width: {analysis.confidence * 100}%"></span>
                </span>
                {(analysis.confidence * 100).toFixed(0)}%
              </span>
            </div>

            <div class="analysis-item">
              <span class="item-label">Recommendation</span>
              <span
                class="item-value badge large"
                style="--badge-color: {getRecommendationColor(analysis.recommendation)}"
              >
                {analysis.recommendation}
              </span>
            </div>
          </div>

          <div class="analysis-section">
            <h4>Summary</h4>
            <p>{analysis.summary}</p>
          </div>

          {#if analysis.details && analysis.details.length > 0}
            <div class="analysis-section">
              <h4>Details</h4>
              <ul class="details-list">
                {#each analysis.details as detail}
                  <li>{detail}</li>
                {/each}
              </ul>
            </div>
          {/if}

          <div class="analysis-section">
            <h4>Reasoning</h4>
            <p class="reasoning">{analysis.reasoning}</p>
          </div>

          <div class="meta-info">
            <span>Provider: {analysis.provider}</span>
            <span>Model: {analysis.model}</span>
            {#if analysis.tokensUsed}
              <span>Tokens: {analysis.tokensUsed}</span>
            {/if}
          </div>
        {/if}
      </div>

      <div class="modal-footer">
        {#if hasMultiple}
          <div class="nav-buttons">
            <button class="btn" onclick={goPrev} disabled={currentIndex === 0}>
              Prev
            </button>
            <button class="btn" onclick={goNext} disabled={currentIndex >= results.length - 1}>
              Next
            </button>
          </div>
        {/if}

        <div class="action-buttons">
          {#if currentResult.analysis}
            {#if currentResult.analysis.recommendation === 'approve'}
              <button class="btn success" onclick={() => handleAction('accept')}>
                Accept for Browser
              </button>
            {:else if currentResult.analysis.recommendation === 'review'}
              <button class="btn" onclick={() => handleAction('accept')}>
                Accept Anyway
              </button>
              <button class="btn outline" onclick={onClose}>
                Review Later
              </button>
            {:else}
              <button class="btn danger" onclick={onClose}>
                Needs Fixing
              </button>
              <button class="btn outline" onclick={() => handleAction('accept')}>
                Accept Anyway
              </button>
            {/if}
          {:else}
            <button class="btn" onclick={onClose}>Close</button>
          {/if}
        </div>
      </div>
    {/if}
  </div>
</div>

<style>
  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.8);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
    padding: 2rem;
  }

  .modal-content {
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 12px;
    max-width: 600px;
    width: 100%;
    max-height: 80vh;
    display: flex;
    flex-direction: column;
    box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
  }

  .modal-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 1rem 1.25rem;
    border-bottom: 1px solid var(--border);
  }

  .header-title {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .header-title h2 {
    font-size: 1.125rem;
    font-weight: 600;
  }

  .result-counter {
    font-size: 0.875rem;
    color: var(--text-muted);
  }

  .close-btn {
    background: none;
    border: none;
    color: var(--text-muted);
    font-size: 1.5rem;
    cursor: pointer;
    padding: 0;
    line-height: 1;
    transition: color 0.15s;
  }

  .close-btn:hover {
    color: var(--text-strong);
  }

  .modal-body {
    flex: 1;
    overflow-y: auto;
    padding: 1.25rem;
  }

  .filename-row {
    margin-bottom: 1rem;
  }

  .filename {
    font-family: monospace;
    font-size: 0.875rem;
    color: var(--text-muted);
    background: var(--bg);
    padding: 0.5rem 0.75rem;
    border-radius: 6px;
    display: inline-block;
  }

  .error-message {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 1rem;
    background: rgba(239, 68, 68, 0.1);
    border: 1px solid #ef4444;
    border-radius: 8px;
    color: #ef4444;
  }

  .error-icon {
    width: 24px;
    height: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #ef4444;
    color: var(--text-strong);
    border-radius: 50%;
    font-weight: 600;
    font-size: 0.875rem;
  }

  .analysis-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 1rem;
    margin-bottom: 1.5rem;
  }

  .analysis-item {
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
  }

  .item-label {
    font-size: 0.75rem;
    color: var(--text-muted);
    text-transform: uppercase;
  }

  .item-value {
    font-size: 0.9rem;
    color: var(--text-strong);
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .badge {
    display: inline-flex;
    padding: 0.25rem 0.6rem;
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid var(--badge-color);
    border-radius: 4px;
    color: var(--badge-color);
    font-size: 0.8rem;
    text-transform: capitalize;
  }

  .badge.large {
    padding: 0.375rem 0.75rem;
    font-size: 0.875rem;
    font-weight: 600;
  }

  .confidence-bar {
    width: 60px;
    height: 6px;
    background: var(--border);
    border-radius: 3px;
    overflow: hidden;
  }

  .confidence-fill {
    height: 100%;
    background: var(--accent);
    border-radius: 3px;
  }

  .analysis-section {
    margin-bottom: 1.25rem;
  }

  .analysis-section h4 {
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--text-muted);
    text-transform: uppercase;
    margin-bottom: 0.5rem;
  }

  .analysis-section p {
    color: var(--text-muted);
    line-height: 1.5;
    font-size: 0.9rem;
  }

  .details-list {
    margin: 0;
    padding-left: 1.25rem;
    color: var(--text-muted);
    font-size: 0.875rem;
    line-height: 1.6;
  }

  .details-list li {
    margin-bottom: 0.25rem;
  }

  .reasoning {
    color: var(--text-muted);
    font-style: italic;
  }

  .meta-info {
    display: flex;
    gap: 1rem;
    padding-top: 1rem;
    border-top: 1px solid var(--border);
    font-size: 0.75rem;
    color: var(--text-muted);
  }

  .modal-footer {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 1rem 1.25rem;
    border-top: 1px solid var(--border);
    gap: 1rem;
  }

  .nav-buttons {
    display: flex;
    gap: 0.5rem;
  }

  .action-buttons {
    display: flex;
    gap: 0.5rem;
    margin-left: auto;
  }

  .btn {
    padding: 0.5rem 1rem;
    border: 1px solid var(--border-soft);
    border-radius: 6px;
    background: var(--border);
    color: var(--text-strong);
    font-size: 0.875rem;
    cursor: pointer;
    transition: all 0.15s;
  }

  .btn:hover:not(:disabled) {
    background: var(--border-soft);
    border-color: var(--border-soft);
  }

  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .btn.success {
    background: #22c55e;
    border-color: #22c55e;
    color: var(--text-strong);
  }

  .btn.success:hover:not(:disabled) {
    background: #16a34a;
    border-color: #16a34a;
  }

  .btn.danger {
    background: #ef4444;
    border-color: #ef4444;
  }

  .btn.danger:hover:not(:disabled) {
    background: #dc2626;
    border-color: #dc2626;
  }

  .btn.outline {
    background: transparent;
    border-color: var(--text-muted);
    color: var(--text-muted);
  }

  .btn.outline:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.05);
    border-color: var(--text-muted);
    color: var(--text-strong);
  }
</style>
