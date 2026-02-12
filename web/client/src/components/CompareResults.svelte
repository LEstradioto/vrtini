<script lang="ts">
  import type { CompareResult } from '../lib/api';

  type ImageType = 'baseline' | 'test' | 'diff';

  let {
    compareResult,
    compareLeft,
    compareRight,
    comparing,
    threshold = $bindable(),
    getImageUrl,
    onRecompare,
    onOpenFullscreen,
  } = $props<{
    compareResult: CompareResult;
    compareLeft: { type: ImageType; filename: string };
    compareRight: { type: ImageType; filename: string };
    comparing: boolean;
    threshold: number;
    getImageUrl: (type: ImageType, filename: string) => string;
    onRecompare: () => void;
    onOpenFullscreen: () => void;
  }>();
</script>

<div class="compare-results">
  <div class="threshold-control">
    <label class="threshold-label">
      <span>Threshold:</span>
      <input type="range" min="0" max="1" step="0.01" bind:value={threshold} class="threshold-slider" />
      <input type="number" min="0" max="1" step="0.01" bind:value={threshold} class="threshold-input" />
    </label>
    <button class="btn small" onclick={onRecompare} disabled={comparing}>
      {comparing ? 'Comparing...' : 'Re-compare'}
    </button>
  </div>
  <div class="compare-stats">
    <div class="stat">
      <span class="stat-label">Pixel Diff</span>
      <span class="stat-value">{compareResult.pixelDiff.toLocaleString()}</span>
    </div>
    <div class="stat">
      <span class="stat-label">Diff %</span>
      <span class="stat-value">{compareResult.diffPercentage.toFixed(2)}%</span>
    </div>
    {#if compareResult.ssimScore !== undefined}
      <div class="stat">
        <span class="stat-label">SSIM</span>
        <span class="stat-value">{(compareResult.ssimScore * 100).toFixed(1)}%</span>
      </div>
    {/if}
    {#if compareResult.phash}
      <div class="stat">
        <span class="stat-label">pHash</span>
        <span class="stat-value">{(compareResult.phash.similarity * 100).toFixed(1)}%</span>
      </div>
    {/if}
  </div>

  <div class="compare-images">
    <button class="compare-image-card clickable" onclick={onOpenFullscreen} title="Click to view fullscreen">
      <img src={getImageUrl(compareLeft.type, compareLeft.filename)} alt="Left" />
    </button>
    <button class="compare-image-card clickable" onclick={onOpenFullscreen} title="Click to view fullscreen">
      <img src={getImageUrl(compareRight.type, compareRight.filename)} alt="Right" />
    </button>
    <button class="compare-image-card clickable" onclick={onOpenFullscreen} title="Click to view fullscreen">
      <img src={compareResult.diffUrl} alt="Diff" />
    </button>
  </div>
</div>

<style>
  .compare-results {
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 0;
    padding: 1rem;
  }

  .threshold-control {
    display: flex;
    align-items: center;
    gap: 1rem;
    margin-bottom: 1rem;
    padding-bottom: 1rem;
    border-bottom: 1px solid var(--border);
  }

  .threshold-label {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    flex: 1;
    font-size: 0.875rem;
    color: var(--text-muted);
  }
  .threshold-label span { min-width: 70px; }

  .threshold-input {
    width: 70px;
    padding: 0.375rem 0.5rem;
    background: var(--panel-strong);
    border: 1px solid var(--border);
    border-radius: 0;
    color: var(--text);
    font-size: 0.875rem;
    text-align: center;
  }
  .threshold-input:focus { outline: none; border-color: var(--accent); }

  .threshold-slider {
    flex: 1;
    height: 6px;
    -webkit-appearance: none;
    appearance: none;
    background: var(--border);
    border-radius: 0;
    outline: none;
    cursor: pointer;
  }
  .threshold-slider::-webkit-slider-thumb {
    -webkit-appearance: none; appearance: none;
    width: 16px; height: 16px; border-radius: 0;
    background: var(--accent); cursor: pointer; transition: background 0.15s;
  }
  .threshold-slider::-webkit-slider-thumb:hover { background: var(--accent-strong); }
  .threshold-slider::-moz-range-thumb {
    width: 16px; height: 16px; border-radius: 0;
    background: var(--accent); cursor: pointer; border: none;
  }

  .compare-stats {
    display: flex;
    gap: 1.5rem;
    margin-bottom: 1rem;
    padding-bottom: 1rem;
    border-bottom: 1px solid var(--border);
  }

  .stat { display: flex; flex-direction: column; gap: 0.25rem; }
  .stat-label { font-size: 0.75rem; color: var(--text-muted); text-transform: uppercase; }
  .stat-value { font-size: 1.25rem; font-weight: 600; color: var(--text-strong); }

  .compare-images {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 1rem;
  }

  .compare-image-card {
    position: relative;
    background: var(--bg);
    border: 1px solid var(--border);
    border-radius: 0;
    overflow: hidden;
  }
  .compare-image-card img { width: 100%; display: block; }
  .compare-image-card.clickable { cursor: pointer; transition: border-color 0.15s; }
  .compare-image-card.clickable:hover { border-color: var(--text-muted); }

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
  .btn.small { padding: 0.375rem 0.75rem; font-size: 0.8rem; }
</style>
