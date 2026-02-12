<script lang="ts">
  import type { GalleryImage, CompareMetrics, ColumnMode } from './gallery-types.js';

  interface Props {
    isCompareMode: boolean;
    displayTitle: string;
    effectiveCompareBadge: { label: string; tone: string } | null;
    effectiveCompareAIBadge: {
      label: string;
      tone: string;
      detail?: string;
      category?: string;
      confidence?: number;
    } | null;
    effectiveCompareUpdatedAt?: { left?: string; right?: string; diff?: string } | null;
    queueUpdatedAt?: { label: string; iso: string } | null;
    hasCompareQueue: boolean;
    compareIndexValue: number;
    compareQueueLength: number;
    effectiveCompareMetrics: CompareMetrics | undefined;
    currentImage: GalleryImage | undefined;
    currentIndex: number;
    queueLength: number;
    baselineDims: { w: number; h: number } | null;
    testDims: { w: number; h: number } | null;
    currentView: 'baseline' | 'test' | 'diff';
    hasDiff: boolean;
    hasBaseline: boolean;
    diffOpacity: number;
    leftLabel: string;
    rightLabel: string;
    diffLabel: string;
    zoom: number;
    columnMode: ColumnMode;
    baseImageSrc: string;
    localThreshold: number;
    recomparing: boolean;
    onViewChange: (view: 'baseline' | 'test' | 'diff') => void;
    onZoomIn: () => void;
    onZoomOut: () => void;
    onResetZoom: () => void;
    onFitToHeight: () => void;
    onColumnModeChange: (mode: ColumnMode) => void;
    onToggleColumnMode: () => void;
    onDiffOpacityChange: (value: number) => void;
    onClose: () => void;
    onRecompare?: () => Promise<void>;
    onThresholdChange?: (threshold: number) => void;
    onLocalThresholdChange: (value: number) => void;
  }

  let {
    isCompareMode,
    displayTitle,
    effectiveCompareBadge,
    effectiveCompareAIBadge,
    effectiveCompareUpdatedAt = null,
    queueUpdatedAt = null,
    hasCompareQueue,
    compareIndexValue,
    compareQueueLength,
    effectiveCompareMetrics,
    currentImage,
    currentIndex,
    queueLength,
    baselineDims,
    testDims,
    currentView,
    hasDiff,
    hasBaseline,
    diffOpacity,
    leftLabel,
    rightLabel,
    diffLabel,
    zoom,
    columnMode,
    baseImageSrc,
    localThreshold,
    recomparing,
    onViewChange,
    onZoomIn,
    onZoomOut,
    onResetZoom,
    onFitToHeight,
    onColumnModeChange,
    onToggleColumnMode,
    onDiffOpacityChange,
    onClose,
    onRecompare,
    onThresholdChange,
    onLocalThresholdChange,
  }: Props = $props();

  function getStatusColor(status: 'passed' | 'failed' | 'new'): string {
    switch (status) {
      case 'failed':
        return '#ef4444';
      case 'new':
        return '#f59e0b';
      case 'passed':
        return '#22c55e';
    }
  }

  function formatUpdatedAt(iso?: string): string {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return d.toLocaleString();
  }

  function getDiffColor(pct: number): string {
    if (pct < 1) return '#22c55e';
    if (pct <= 5) return '#f59e0b';
    return '#ef4444';
  }

  function getSsimColor(pct: number): string {
    if (pct > 98) return '#22c55e';
    if (pct >= 95) return '#f59e0b';
    return '#ef4444';
  }

  function getPHashColor(pct: number): string {
    if (pct > 98) return '#22c55e';
    if (pct >= 95) return '#f59e0b';
    return '#ef4444';
  }

  function getAIMetricColor(tone?: string): string {
    if (tone === 'ai-approved') return '#4ade80';
    if (tone === 'ai-review') return '#facc15';
    if (tone === 'ai-rejected') return '#fb7185';
    return 'var(--text-strong)';
  }
</script>

<div class="gallery-header">
  <div class="header-left">
    {#if isCompareMode}
      <div class="compare-left">
        <div class="compare-left-top">
          <div class="compare-left-title">
            <span class="filename" title={displayTitle}>{displayTitle}</span>
            {#if effectiveCompareBadge}
              <span class="compare-badge {`tone-${effectiveCompareBadge.tone}`.trim()}">
                {effectiveCompareBadge.label}
              </span>
            {/if}
            {#if effectiveCompareAIBadge}
              <span class="compare-badge {`tone-${effectiveCompareAIBadge.tone}`.trim()}">
                {effectiveCompareAIBadge.label}
              </span>
            {/if}
            {#if hasCompareQueue}
              <span class="position-indicator compare-count">
                {compareIndexValue + 1} / {compareQueueLength}
              </span>
            {/if}
          </div>

          {#if effectiveCompareMetrics}
            <div class="metrics-display compare-inline">
              <span class="metric" title="Percentage of differing pixels (pixel diff ÷ total pixels).">
                <span class="metric-label">Diff</span>
                <span class="metric-value" style="color: {getDiffColor(effectiveCompareMetrics.diffPercentage)}">{effectiveCompareMetrics.diffPercentage.toFixed(2)}%</span>
              </span>
              {#if effectiveCompareMetrics.ssimScore !== undefined}
                <span class="metric" title="SSIM (Structural Similarity Index). Higher is more similar.">
                  <span class="metric-label">SSIM</span>
                  <span class="metric-value" style="color: {getSsimColor(effectiveCompareMetrics.ssimScore * 100)}">{(effectiveCompareMetrics.ssimScore * 100).toFixed(1)}%</span>
                </span>
              {/if}
              <span class="metric" title="Number of pixels that differ between baseline and test.">
                <span class="metric-label">Px</span>
                <span class="metric-value">{effectiveCompareMetrics.pixelDiff.toLocaleString()}</span>
              </span>
              {#if effectiveCompareMetrics.phash}
                <span class="metric" title="Perceptual hash similarity. Higher is more similar.">
                  <span class="metric-label">pHash</span>
                  <span class="metric-value" style="color: {getPHashColor(effectiveCompareMetrics.phash.similarity * 100)}">
                    {(effectiveCompareMetrics.phash.similarity * 100).toFixed(1)}%
                  </span>
                </span>
              {/if}
              {#if effectiveCompareAIBadge}
                <span
                  class="metric"
                  title={effectiveCompareAIBadge.detail
                    ? `AI triage confidence (${effectiveCompareAIBadge.detail})`
                    : 'AI triage recommendation'}
                >
                  <span class="metric-label">AI</span>
                  <span class="metric-value" style="color: {getAIMetricColor(effectiveCompareAIBadge.tone)}">
                    {typeof effectiveCompareAIBadge.confidence === 'number'
                      ? `${(effectiveCompareAIBadge.confidence * 100).toFixed(0)}%`
                      : effectiveCompareAIBadge.label.replace('AI ', '')}
                  </span>
                </span>
              {/if}
            </div>
          {/if}
        </div>

        {#if effectiveCompareUpdatedAt && (effectiveCompareUpdatedAt.left || effectiveCompareUpdatedAt.right || effectiveCompareUpdatedAt.diff)}
          <div class="updated-at updated-at--plain">
            {#if effectiveCompareUpdatedAt.left}
              <span class="updated-at-item" title={effectiveCompareUpdatedAt.left}>
                {leftLabel}: {formatUpdatedAt(effectiveCompareUpdatedAt.left)}
              </span>
            {/if}
            {#if effectiveCompareUpdatedAt.right}
              <span class="updated-at-item" title={effectiveCompareUpdatedAt.right}>
                {rightLabel}: {formatUpdatedAt(effectiveCompareUpdatedAt.right)}
              </span>
            {/if}
            {#if effectiveCompareUpdatedAt.diff}
              <span class="updated-at-item" title={effectiveCompareUpdatedAt.diff}>
                {diffLabel}: {formatUpdatedAt(effectiveCompareUpdatedAt.diff)}
              </span>
            {/if}
          </div>
        {/if}
      </div>
    {:else}
      <div class="queue-left">
        <div class="queue-left-top">
          <span class="position-indicator">{currentIndex + 1} / {queueLength}</span>
          {#if currentImage}
            <span class="filename" title={currentImage.filename}>{currentImage.filename}</span>
            <span class="status-badge" style="background: {getStatusColor(currentImage.status)}">
              {currentImage.status}
            </span>
            {#if currentImage.confidence}
              <span class="confidence-badge {currentImage.confidence.verdict}">
                {currentImage.confidence.score}%
              </span>
            {/if}
            {#if currentImage.metrics}
              <div class="metrics-display compact">
                <span class="metric" title="Percentage of differing pixels (pixel diff ÷ total pixels).">
                  <span class="metric-label">Diff</span>
                  <span class="metric-value" style="color: {getDiffColor(currentImage.metrics.diffPercentage)}">{currentImage.metrics.diffPercentage.toFixed(2)}%</span>
                </span>
                {#if currentImage.metrics.ssimScore !== undefined}
                  <span class="metric" title="SSIM (Structural Similarity Index). Higher is more similar.">
                    <span class="metric-label">SSIM</span>
                    <span class="metric-value" style="color: {getSsimColor(currentImage.metrics.ssimScore * 100)}">{(currentImage.metrics.ssimScore * 100).toFixed(1)}%</span>
                  </span>
                {/if}
                <span class="metric" title="Number of pixels that differ between baseline and test.">
                  <span class="metric-label">Px</span>
                  <span class="metric-value">{currentImage.metrics.pixelDiff.toLocaleString()}</span>
                </span>
                {#if currentImage.metrics.phash}
                  <span class="metric" title="Perceptual hash similarity. Higher is more similar.">
                    <span class="metric-label">pHash</span>
                    <span class="metric-value" style="color: {getPHashColor(currentImage.metrics.phash.similarity * 100)}">
                      {(currentImage.metrics.phash.similarity * 100).toFixed(1)}%
                    </span>
                  </span>
                {/if}
              </div>
            {/if}
            {#if baselineDims || testDims}
              <div class="dims-display">
                {#if baselineDims}
                  <span class="dim-item">
                    <span class="dim-label">B:</span>
                    <span class="dim-value">{baselineDims.w}x{baselineDims.h}</span>
                  </span>
                {/if}
                {#if testDims}
                  <span class="dim-item">
                    <span class="dim-label">T:</span>
                    <span class="dim-value">{testDims.w}x{testDims.h}</span>
                  </span>
                {/if}
                {#if baselineDims && testDims && (baselineDims.w !== testDims.w || baselineDims.h !== testDims.h)}
                  <span class="dim-mismatch" title="Dimension mismatch">!</span>
                {/if}
              </div>
            {/if}
          {/if}
        </div>

        {#if queueUpdatedAt?.iso}
          <div class="updated-at updated-at--plain">
            <span class="updated-at-item" title={queueUpdatedAt.iso}>
              Updated ({queueUpdatedAt.label}): {formatUpdatedAt(queueUpdatedAt.iso)}
            </span>
          </div>
        {/if}
      </div>
    {/if}
    {#if currentView === 'diff' && hasDiff}
      <div class="opacity-control">
        <span class="opacity-label">Diff:</span>
        <input
          type="range"
          min="0"
          max="100"
          value={diffOpacity}
          oninput={(e) => onDiffOpacityChange(Number((e.target as HTMLInputElement).value))}
          class="opacity-slider"
        />
        <span class="opacity-value">{diffOpacity}%</span>
      </div>
    {/if}
  </div>

  <div class="header-center">
    <div class="view-tabs">
      <button
        class="view-tab"
        class:active={currentView === 'baseline'}
        class:disabled={!hasBaseline}
        onclick={() => hasBaseline && onViewChange('baseline')}
        disabled={!hasBaseline}
      >
        {leftLabel} <kbd>1</kbd>
      </button>
      <button
        class="view-tab"
        class:active={currentView === 'test'}
        onclick={() => onViewChange('test')}
      >
        {rightLabel} <kbd>2</kbd>
      </button>
      <button
        class="view-tab"
        class:active={currentView === 'diff'}
        class:disabled={!hasDiff}
        onclick={() => hasDiff && onViewChange('diff')}
        disabled={!hasDiff}
      >
        {diffLabel} <kbd>3</kbd>
      </button>
    </div>

    <div class="zoom-controls">
      <button class="zoom-btn" onclick={onZoomOut}>-</button>
      <span class="zoom-level">{Math.round(zoom * 100)}%</span>
      <button class="zoom-btn" onclick={onZoomIn}>+</button>
      <button class="zoom-btn" onclick={onResetZoom} title="Fit width (W)">W</button>
      <button class="zoom-btn" onclick={onFitToHeight} title="Fit height (H)">H</button>
    </div>
    {#if baseImageSrc}
      <div class="column-controls">
        <label for="column-mode">Columns</label>
        <select id="column-mode" value={columnMode} onchange={(e) => onColumnModeChange((e.target as HTMLSelectElement).value as ColumnMode)}>
          <option value="auto">Auto</option>
          <option value="1">1</option>
          <option value="2">2</option>
          <option value="3">3</option>
          <option value="4">4</option>
          <option value="5">5</option>
          <option value="6">6</option>
          <option value="7">7</option>
          <option value="8">8</option>
          <option value="9">9</option>
          <option value="10">10</option>
          <option value="11">11</option>
          <option value="12">12</option>
          <option value="13">13</option>
          <option value="14">14</option>
          <option value="15">15</option>
        </select>
        <button class="fit-columns-btn" onclick={onToggleColumnMode} title="Toggle single/multi column (C)">
          {columnMode === '1' ? 'Multi' : 'Single'}
        </button>
      </div>
    {/if}
  </div>

  <div class="header-right">
    {#if isCompareMode && onRecompare}
      <div class="threshold-control">
        <span class="threshold-label">Threshold:</span>
        <input
          type="range"
          min="0"
          max="1"
          step="0.01"
          value={localThreshold}
          oninput={(e) => onLocalThresholdChange(Number((e.target as HTMLInputElement).value))}
          class="threshold-slider"
          onchange={() => onThresholdChange?.(localThreshold)}
        />
        <input
          type="number"
          min="0"
          max="1"
          step="0.01"
          value={localThreshold}
          oninput={(e) => onLocalThresholdChange(Number((e.target as HTMLInputElement).value))}
          class="threshold-input"
          onchange={() => onThresholdChange?.(localThreshold)}
        />
        <button
          class="action-btn recompare"
          onclick={onRecompare}
          disabled={recomparing}
        >
          {recomparing ? 'Comparing...' : 'Re-compare'}
        </button>
      </div>
    {/if}
    <button class="close-btn" onclick={onClose}>
      Close <kbd>Esc</kbd>
    </button>
  </div>
</div>

<style>
  .gallery-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 8px 16px;
    background: var(--bg);
    border-bottom: 1px solid var(--border);
    font-family: var(--font-mono, 'JetBrains Mono', monospace);
    flex-wrap: wrap;
    gap: 8px;
  }

  .header-left {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
    flex: 1;
  }

  .queue-left {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
  }

  .queue-left-top {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
    flex-wrap: wrap;
  }

  .compare-left {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
  }

  .compare-left-top {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
    flex-wrap: wrap;
  }

  .compare-left-title {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }

  .updated-at {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    color: var(--text-muted);
    font-size: 10px;
  }

  .updated-at.updated-at--plain {
    padding: 0;
    border: none;
    background: transparent;
    opacity: 0.7;
  }

  .updated-at-item {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 280px;
  }

  .position-indicator {
    font-size: 12px;
    color: var(--text-muted);
    font-weight: 500;
  }

  .compare-count {
    padding: 1px 6px;
    border-radius: 0;
    border: 1px solid var(--border);
    background: transparent;
    color: var(--text-strong);
    font-size: 11px;
  }

  .filename {
    font-size: 14px;
    font-weight: 600;
    color: var(--accent, #10B981);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .compare-badge {
    padding: 2px 8px;
    border-radius: 0;
    font-size: 10px;
    font-weight: 500;
    text-transform: lowercase;
    letter-spacing: 0.05em;
    border: 1px solid var(--border);
    background: transparent;
    color: var(--text-muted);
  }

  .compare-badge.tone-approved {
    border-color: rgba(34, 197, 94, 0.5);
    color: #22c55e;
  }

  .compare-badge.tone-smart {
    border-color: rgba(20, 184, 166, 0.5);
    color: #14b8a6;
  }

  .compare-badge.tone-passed {
    border-color: rgba(56, 189, 248, 0.5);
    color: #38bdf8;
  }

  .compare-badge.tone-diff {
    border-color: rgba(249, 115, 22, 0.5);
    color: #f97316;
  }

  .compare-badge.tone-flagged {
    border-color: rgba(255, 107, 0, 0.7);
    color: #ff6b00;
  }

  .compare-badge.tone-unapproved,
  .compare-badge.tone-issue {
    border-color: rgba(239, 68, 68, 0.5);
    color: #ef4444;
  }

  .compare-badge.tone-ai-approved {
    border-color: rgba(34, 197, 94, 0.65);
    color: #4ade80;
  }

  .compare-badge.tone-ai-review {
    border-color: rgba(234, 179, 8, 0.65);
    color: #facc15;
  }

  .compare-badge.tone-ai-rejected {
    border-color: rgba(244, 63, 94, 0.65);
    color: #fb7185;
  }

  .status-badge {
    padding: 2px 8px;
    border-radius: 0;
    font-size: 10px;
    font-weight: 500;
    text-transform: lowercase;
    color: var(--text-strong);
  }

  .confidence-badge {
    padding: 2px 8px;
    border-radius: 0;
    font-size: 11px;
    font-weight: 500;
  }

  .confidence-badge.pass {
    background: transparent;
    color: #4ade80;
    border: 1px solid rgba(34, 197, 94, 0.4);
  }

  .confidence-badge.warn {
    background: transparent;
    color: #fb923c;
    border: 1px solid rgba(249, 115, 22, 0.4);
  }

  .confidence-badge.fail {
    background: transparent;
    color: #f87171;
    border: 1px solid rgba(239, 68, 68, 0.4);
  }

  .metrics-display.compact {
    display: flex;
    gap: 10px;
    padding: 2px 8px;
    background: transparent;
    border: 1px solid var(--border);
    border-radius: 0;
  }

  .dims-display {
    display: flex;
    gap: 6px;
    align-items: center;
    padding: 2px 8px;
    background: transparent;
    border: 1px solid var(--border);
    border-radius: 0;
    font-size: 11px;
  }

  .dim-item {
    display: flex;
    gap: 3px;
    align-items: center;
  }

  .dim-label {
    color: var(--text-muted);
    font-weight: 500;
  }

  .dim-value {
    color: var(--text-muted);
    font-family: var(--font-mono, monospace);
  }

  .dim-mismatch {
    color: #f59e0b;
    font-weight: 700;
    font-size: 13px;
  }

  .opacity-control {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 2px 8px;
    background: transparent;
    border: 1px solid var(--border);
    border-radius: 0;
    margin-left: 4px;
  }

  .opacity-label {
    font-size: 11px;
    color: var(--text-muted);
  }

  .opacity-slider {
    width: 60px;
    height: 3px;
    -webkit-appearance: none;
    appearance: none;
    background: var(--border-soft);
    border-radius: 0;
    outline: none;
    cursor: pointer;
  }

  .opacity-slider::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 12px;
    height: 12px;
    border-radius: 0;
    background: var(--accent);
    cursor: pointer;
  }

  .opacity-slider::-moz-range-thumb {
    width: 12px;
    height: 12px;
    border-radius: 0;
    background: var(--accent);
    cursor: pointer;
    border: none;
  }

  .opacity-value {
    font-size: 11px;
    color: var(--text-muted);
    min-width: 32px;
  }

  .header-center {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-wrap: wrap;
  }

  .view-tabs {
    display: flex;
    gap: 0;
    border: 1px solid var(--border);
  }

  .view-tab {
    padding: 5px 12px;
    background: transparent;
    border: none;
    border-right: 1px solid var(--border);
    color: var(--text-muted);
    border-radius: 0;
    cursor: pointer;
    font-family: var(--font-mono, monospace);
    font-size: 11px;
    font-weight: 500;
    transition: color 0.15s, background 0.15s;
    text-transform: lowercase;
  }

  .view-tab:last-child {
    border-right: none;
  }

  .view-tab:hover:not(:disabled) {
    color: var(--text-strong);
    background: rgba(255, 255, 255, 0.04);
  }

  .view-tab.active {
    background: transparent;
    color: var(--accent, #10B981);
    border-bottom: 2px solid var(--accent, #10B981);
  }

  .view-tab.disabled,
  .view-tab:disabled {
    opacity: 0.3;
    cursor: not-allowed;
  }

  .view-tab kbd {
    display: inline-block;
    padding: 1px 4px;
    margin-left: 4px;
    background: rgba(255, 255, 255, 0.08);
    border-radius: 0;
    font-size: 9px;
    border: 1px solid var(--border);
  }

  .zoom-controls {
    display: flex;
    gap: 0;
    align-items: center;
    border: 1px solid var(--border);
    padding: 0;
    border-radius: 0;
  }

  .metrics-display.compare-inline {
    justify-content: flex-end;
  }

  .column-controls {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 2px 8px;
    border: 1px solid var(--border);
    border-radius: 0;
    color: var(--text-muted);
    font-size: 11px;
    font-weight: 500;
  }

  .column-controls select {
    background: transparent;
    border: 1px solid var(--border);
    color: var(--text-strong);
    padding: 2px 6px;
    border-radius: 0;
    font-family: var(--font-mono, monospace);
    font-size: 11px;
  }

  .fit-columns-btn {
    background: transparent;
    border: 1px solid var(--border);
    color: var(--text-strong);
    padding: 2px 6px;
    border-radius: 0;
    font-family: var(--font-mono, monospace);
    font-size: 11px;
    cursor: pointer;
  }

  .fit-columns-btn:hover {
    border-color: var(--accent);
    color: var(--accent);
  }

  .fit-columns-btn.active {
    border-color: var(--accent);
    color: var(--accent);
  }

  .zoom-btn {
    padding: 5px 10px;
    background: transparent;
    border: none;
    border-right: 1px solid var(--border);
    color: var(--text-strong);
    border-radius: 0;
    cursor: pointer;
    font-family: var(--font-mono, monospace);
    font-size: 12px;
    transition: color 0.15s;
  }

  .zoom-btn:last-child {
    border-right: none;
  }

  .zoom-btn:hover {
    color: var(--accent);
  }

  .zoom-level {
    color: var(--text-muted);
    font-size: 11px;
    min-width: 40px;
    text-align: center;
    padding: 0 4px;
  }

  .header-right {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .close-btn {
    padding: 5px 12px;
    background: transparent;
    border: 1px solid #ef4444;
    color: #ef4444;
    border-radius: 0;
    cursor: pointer;
    font-family: var(--font-mono, monospace);
    font-size: 11px;
    font-weight: 500;
    transition: all 0.15s;
    text-transform: lowercase;
  }

  .close-btn:hover {
    background: #ef4444;
    color: var(--bg);
  }

  .close-btn kbd {
    display: inline-block;
    padding: 1px 4px;
    margin-left: 4px;
    background: rgba(255, 255, 255, 0.08);
    border-radius: 0;
    font-size: 9px;
    border: 1px solid rgba(239, 68, 68, 0.3);
  }

  .metrics-display {
    display: flex;
    gap: 12px;
    padding: 2px 8px;
    background: transparent;
    border: 1px solid var(--border);
    border-radius: 0;
  }

  .metric {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 1px;
  }

  .metric-label {
    font-size: 9px;
    color: var(--text-muted);
    text-transform: lowercase;
    letter-spacing: 0.05em;
  }

  .metric-value {
    font-size: 12px;
    font-weight: 600;
    color: var(--text-strong);
  }

  .threshold-control {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .threshold-label {
    font-size: 11px;
    color: var(--text-muted);
  }

  .threshold-slider {
    width: 80px;
    height: 3px;
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
    width: 12px;
    height: 12px;
    border-radius: 0;
    background: var(--accent);
    cursor: pointer;
  }

  .threshold-slider::-webkit-slider-thumb:hover {
    background: var(--accent-strong);
  }

  .threshold-slider::-moz-range-thumb {
    width: 12px;
    height: 12px;
    border-radius: 0;
    background: var(--accent);
    cursor: pointer;
    border: none;
  }

  .threshold-input {
    width: 52px;
    padding: 4px 6px;
    background: transparent;
    border: 1px solid var(--border);
    border-radius: 0;
    color: var(--text-strong);
    font-family: var(--font-mono, monospace);
    font-size: 11px;
    text-align: center;
  }

  .threshold-input:focus {
    outline: none;
    border-color: var(--accent);
  }

  .action-btn.recompare {
    background: transparent;
    border: 1px solid var(--accent);
    color: var(--accent);
    padding: 5px 12px;
    border-radius: 0;
    font-family: var(--font-mono, monospace);
    font-size: 11px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s;
    text-transform: lowercase;
  }

  .action-btn.recompare:hover:not(:disabled) {
    background: var(--accent);
    color: var(--bg);
  }
</style>
