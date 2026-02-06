<script lang="ts">
  import type { GalleryImage, CompareMetrics, ColumnMode } from './gallery-types.js';

  interface Props {
    isCompareMode: boolean;
    displayTitle: string;
    effectiveCompareBadge: { label: string; tone: string } | null;
    effectiveCompareUpdatedAt?: { left?: string; right?: string; diff?: string } | null;
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
    panicActive: boolean;
    zoom: number;
    columnMode: ColumnMode;
    baseImageSrc: string;
    showThumbnails: boolean;
    localThreshold: number;
    recomparing: boolean;
    onViewChange: (view: 'baseline' | 'test' | 'diff') => void;
    onTogglePanic: () => void;
    onZoomIn: () => void;
    onZoomOut: () => void;
    onResetZoom: () => void;
    onFitToHeight: () => void;
    onColumnModeChange: (mode: ColumnMode) => void;
    onToggleColumnMode: () => void;
    onFitColumnsToScreen: () => void;
    onDiffOpacityChange: (value: number) => void;
    onToggleThumbnails: () => void;
    onClose: () => void;
    onRecompare?: () => Promise<void>;
    onThresholdChange?: (threshold: number) => void;
    onLocalThresholdChange: (value: number) => void;
  }

  let {
    isCompareMode,
    displayTitle,
    effectiveCompareBadge,
    effectiveCompareUpdatedAt = null,
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
    panicActive,
    zoom,
    columnMode,
    baseImageSrc,
    showThumbnails,
    localThreshold,
    recomparing,
    onViewChange,
    onTogglePanic,
    onZoomIn,
    onZoomOut,
    onResetZoom,
    onFitToHeight,
    onColumnModeChange,
    onToggleColumnMode,
    onFitColumnsToScreen,
    onDiffOpacityChange,
    onToggleThumbnails,
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
</script>

<div class="gallery-header">
  <div class="header-left">
    {#if isCompareMode}
      <div class="compare-left">
        <div class="compare-left-top">
          <span class="filename" title={displayTitle}>{displayTitle}</span>
          {#if effectiveCompareBadge}
            <span class="compare-badge {`tone-${effectiveCompareBadge.tone}`.trim()}">
              {effectiveCompareBadge.label}
            </span>
          {/if}
          {#if hasCompareQueue}
            <span class="position-indicator compare-count">
              {compareIndexValue + 1} / {compareQueueLength}
            </span>
          {/if}
        </div>

        {#if effectiveCompareMetrics || effectiveCompareUpdatedAt}
          <div class="compare-left-bottom">
            {#if effectiveCompareMetrics}
              <div class="metrics-display">
                <span
                  class="metric"
                  title="Number of pixels that differ between baseline and test."
                >
                  <span class="metric-label">Pixels</span>
                  <span class="metric-value">{effectiveCompareMetrics.pixelDiff.toLocaleString()}</span>
                </span>
                <span
                  class="metric"
                  title="Percentage of differing pixels (pixel diff ÷ total pixels)."
                >
                  <span class="metric-label">Diff</span>
                  <span class="metric-value">{effectiveCompareMetrics.diffPercentage.toFixed(2)}%</span>
                </span>
                {#if effectiveCompareMetrics.ssimScore !== undefined}
                  <span
                    class="metric"
                    title="SSIM (Structural Similarity Index). Higher is more similar."
                  >
                    <span class="metric-label">SSIM</span>
                    <span class="metric-value">{(effectiveCompareMetrics.ssimScore * 100).toFixed(1)}%</span>
                  </span>
                {/if}
                {#if effectiveCompareMetrics.phash}
                  <span
                    class="metric"
                    title="Perceptual hash similarity. Higher is more similar."
                  >
                    <span class="metric-label">pHash</span>
                    <span class="metric-value">{(effectiveCompareMetrics.phash.similarity * 100).toFixed(1)}%</span>
                  </span>
                {/if}
              </div>
            {/if}

            {#if effectiveCompareUpdatedAt && (effectiveCompareUpdatedAt.left || effectiveCompareUpdatedAt.right || effectiveCompareUpdatedAt.diff)}
              <div class="updated-at">
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
        {/if}
      </div>
    {:else}
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
            <span
              class="metric"
              title="Percentage of differing pixels (pixel diff ÷ total pixels)."
            >
              <span class="metric-label">Diff</span>
              <span class="metric-value">{currentImage.metrics.diffPercentage.toFixed(2)}%</span>
            </span>
            {#if currentImage.metrics.ssimScore !== undefined}
              <span
                class="metric"
                title="SSIM (Structural Similarity Index). Higher is more similar."
              >
                <span class="metric-label">SSIM</span>
                <span class="metric-value">{(currentImage.metrics.ssimScore * 100).toFixed(1)}%</span>
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
    {#if isCompareMode}
      <button
        class="panic-btn"
        class:active={panicActive}
        onclick={onTogglePanic}
        title="Panic check: alternates baseline/test every 250ms and flashes diff every 7s (P)"
      >
        Panic
      </button>
    {/if}

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
        <button
          class="fit-columns-btn"
          class:active={columnMode === 'auto'}
          onclick={onFitColumnsToScreen}
          title="Auto-fit columns (F)"
        >
          Auto Fit
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
    {#if !isCompareMode}
      <button class="thumbnail-toggle" class:active={showThumbnails} onclick={onToggleThumbnails}>
        Thumbnails <kbd>T</kbd>
      </button>
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
    padding: 10px 16px;
    background: #1a1a2e;
    border-bottom: 1px solid var(--border);
  }

  .header-left {
    display: flex;
    align-items: center;
    gap: 12px;
    min-width: 0;
    flex: 1;
  }

  .compare-left {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
  }

  .compare-left-top {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
  }

  .compare-left-bottom {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 10px;
  }

  .updated-at {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    padding: 3px 8px;
    border-radius: 6px;
    border: 1px solid var(--border);
    background: rgba(255, 255, 255, 0.04);
    color: var(--text-muted);
    font-size: 12px;
  }

  .updated-at-item {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 320px;
  }

  .position-indicator {
    font-size: 14px;
    color: var(--text-muted);
    font-weight: 500;
  }

  .compare-count {
    padding: 2px 8px;
    border-radius: 999px;
    border: 1px solid var(--border);
    background: var(--panel);
    color: var(--text-strong);
    font-size: 12px;
  }

  .filename {
    font-size: 16px;
    font-weight: 600;
    color: var(--text-strong);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .compare-badge {
    padding: 4px 10px;
    border-radius: 999px;
    font-size: 12px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    border: 1px solid var(--border);
    background: var(--panel-strong);
    color: var(--text-muted);
  }

  .compare-badge.tone-approved {
    border-color: rgba(34, 197, 94, 0.4);
    background: rgba(34, 197, 94, 0.12);
    color: #22c55e;
  }

  .compare-badge.tone-smart {
    border-color: rgba(20, 184, 166, 0.4);
    background: rgba(20, 184, 166, 0.12);
    color: #14b8a6;
  }

  .compare-badge.tone-passed {
    border-color: rgba(56, 189, 248, 0.4);
    background: rgba(56, 189, 248, 0.12);
    color: #38bdf8;
  }

  .compare-badge.tone-diff {
    border-color: rgba(249, 115, 22, 0.4);
    background: rgba(249, 115, 22, 0.12);
    color: #f97316;
  }

  .compare-badge.tone-unapproved,
  .compare-badge.tone-issue {
    border-color: rgba(239, 68, 68, 0.4);
    background: rgba(239, 68, 68, 0.12);
    color: #ef4444;
  }

  .status-badge {
    padding: 4px 10px;
    border-radius: 4px;
    font-size: 12px;
    font-weight: 600;
    text-transform: uppercase;
    color: var(--text-strong);
  }

  .confidence-badge {
    padding: 4px 10px;
    border-radius: 4px;
    font-size: 12px;
    font-weight: 600;
  }

  .confidence-badge.pass {
    background: rgba(34, 197, 94, 0.2);
    color: #4ade80;
    border: 1px solid rgba(34, 197, 94, 0.3);
  }

  .confidence-badge.warn {
    background: rgba(249, 115, 22, 0.2);
    color: #fb923c;
    border: 1px solid rgba(249, 115, 22, 0.3);
  }

  .confidence-badge.fail {
    background: rgba(239, 68, 68, 0.2);
    color: #f87171;
    border: 1px solid rgba(239, 68, 68, 0.3);
  }

  .metrics-display.compact {
    display: flex;
    gap: 12px;
    padding: 4px 10px;
    background: var(--border);
    border-radius: 4px;
  }

  .dims-display {
    display: flex;
    gap: 8px;
    align-items: center;
    padding: 4px 10px;
    background: #2a2a3e;
    border-radius: 4px;
    font-size: 12px;
  }

  .dim-item {
    display: flex;
    gap: 4px;
    align-items: center;
  }

  .dim-label {
    color: var(--text-muted);
    font-weight: 500;
  }

  .dim-value {
    color: var(--text-muted);
    font-family: monospace;
  }

  .dim-mismatch {
    color: #f59e0b;
    font-weight: 700;
    font-size: 14px;
  }

  .opacity-control {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 10px;
    background: var(--border);
    border-radius: 4px;
    margin-left: 8px;
  }

  .opacity-label {
    font-size: 12px;
    color: var(--text-muted);
  }

  .opacity-slider {
    width: 80px;
    height: 4px;
    -webkit-appearance: none;
    appearance: none;
    background: var(--border-soft);
    border-radius: 2px;
    outline: none;
    cursor: pointer;
  }

  .opacity-slider::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: var(--accent);
    cursor: pointer;
  }

  .opacity-slider::-moz-range-thumb {
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: var(--accent);
    cursor: pointer;
    border: none;
  }

  .opacity-value {
    font-size: 12px;
    color: var(--text-muted);
    min-width: 36px;
  }

  .header-center {
    display: flex;
    align-items: center;
    gap: 16px;
  }

  .view-tabs {
    display: flex;
    gap: 6px;
  }

  .view-tab {
    padding: 8px 16px;
    background: transparent;
    border: 2px solid var(--border-soft);
    color: var(--text-muted);
    border-radius: 4px;
    cursor: pointer;
    font-size: 13px;
    font-weight: 600;
    transition: all 0.15s;
  }

  .view-tab:hover:not(:disabled) {
    border-color: var(--text-muted);
    color: var(--text-strong);
  }

  .view-tab.active {
    background: #3b82f6;
    border-color: #3b82f6;
    color: var(--text-strong);
  }

  .view-tab.disabled,
  .view-tab:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .view-tab kbd {
    display: inline-block;
    padding: 2px 5px;
    margin-left: 6px;
    background: rgba(255, 255, 255, 0.15);
    border-radius: 3px;
    font-size: 10px;
  }

  .zoom-controls {
    display: flex;
    gap: 4px;
    align-items: center;
    background: var(--border);
    padding: 4px 8px;
    border-radius: 4px;
  }

  .panic-btn {
    background: var(--border);
    border: 1px solid var(--border-soft);
    color: var(--text-strong);
    padding: 4px 10px;
    border-radius: 6px;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
  }

  .panic-btn:hover {
    border-color: var(--accent);
    color: var(--accent);
  }

  .panic-btn.active {
    border-color: rgba(239, 68, 68, 0.8);
    color: rgb(239, 68, 68);
    box-shadow: 0 0 0 1px rgba(239, 68, 68, 0.35);
  }

  .column-controls {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 8px;
    background: var(--border);
    border-radius: 4px;
    color: var(--text-muted);
    font-size: 12px;
    font-weight: 500;
  }

  .column-controls select {
    background: var(--border-soft);
    border: 1px solid var(--border);
    color: var(--text-strong);
    padding: 4px 8px;
    border-radius: 4px;
    font-size: 12px;
  }

  .fit-columns-btn {
    background: var(--border-soft);
    border: 1px solid var(--border);
    color: var(--text-strong);
    padding: 4px 8px;
    border-radius: 4px;
    font-size: 12px;
    cursor: pointer;
  }

  .fit-columns-btn:hover {
    border-color: var(--accent);
    color: var(--accent);
  }

  .fit-columns-btn.active {
    border-color: var(--accent);
    color: var(--accent);
    box-shadow: 0 0 0 1px rgba(120, 200, 255, 0.35);
  }

  .zoom-btn {
    padding: 6px 10px;
    background: var(--border-soft);
    border: none;
    color: var(--text-strong);
    border-radius: 4px;
    cursor: pointer;
    font-size: 13px;
    transition: background 0.15s;
  }

  .zoom-btn:hover {
    background: var(--border-soft);
  }

  .zoom-level {
    color: var(--text-muted);
    font-size: 12px;
    min-width: 45px;
    text-align: center;
  }

  .header-right {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .thumbnail-toggle {
    padding: 8px 14px;
    background: var(--border);
    border: none;
    color: var(--text-muted);
    border-radius: 4px;
    cursor: pointer;
    font-size: 13px;
    transition: all 0.15s;
  }

  .thumbnail-toggle:hover {
    background: var(--border-soft);
    color: var(--text-strong);
  }

  .thumbnail-toggle.active {
    background: var(--accent);
    color: var(--text-strong);
  }

  .thumbnail-toggle kbd {
    display: inline-block;
    padding: 2px 5px;
    margin-left: 6px;
    background: rgba(255, 255, 255, 0.15);
    border-radius: 3px;
    font-size: 10px;
  }

  .close-btn {
    padding: 8px 14px;
    background: #ef4444;
    border: none;
    color: var(--text-strong);
    border-radius: 4px;
    cursor: pointer;
    font-size: 13px;
    font-weight: 500;
    transition: background 0.15s;
  }

  .close-btn:hover {
    background: #dc2626;
  }

  .close-btn kbd {
    display: inline-block;
    padding: 2px 5px;
    margin-left: 6px;
    background: rgba(255, 255, 255, 0.2);
    border-radius: 3px;
    font-size: 10px;
  }

  .metrics-display {
    display: flex;
    gap: 16px;
    padding: 4px 12px;
    background: var(--border);
    border-radius: 4px;
  }

  .metric {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
  }

  .metric-label {
    font-size: 10px;
    color: var(--text-muted);
    text-transform: uppercase;
  }

  .metric-value {
    font-size: 14px;
    font-weight: 600;
    color: var(--text-strong);
  }

  .threshold-control {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .threshold-label {
    font-size: 13px;
    color: var(--text-muted);
  }

  .threshold-slider {
    width: 100px;
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

  .threshold-input {
    width: 60px;
    padding: 6px 8px;
    background: var(--border);
    border: 1px solid var(--border-soft);
    border-radius: 4px;
    color: var(--text-strong);
    font-size: 13px;
    text-align: center;
  }

  .threshold-input:focus {
    outline: none;
    border-color: var(--accent);
  }

  .action-btn.recompare {
    background: var(--border);
    border: 1px solid var(--accent);
    color: var(--accent);
    padding: 8px 16px;
    border-radius: 6px;
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.15s;
  }

  .action-btn.recompare:hover:not(:disabled) {
    background: var(--accent);
    color: var(--text-strong);
  }
</style>
