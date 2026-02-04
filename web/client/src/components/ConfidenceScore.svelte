<script lang="ts">
  interface EngineDetail {
    similarity: number;
    diffPercent: number;
    error?: string;
  }

  interface Props {
    score: number;
    verdict: 'pass' | 'warn' | 'fail';
    details?: Record<string, EngineDetail>;
    size?: 'sm' | 'md' | 'lg';
  }

  let { score, verdict, details, size = 'md' }: Props = $props();

  const colors: Record<string, string> = {
    pass: 'color-pass',
    warn: 'color-warn',
    fail: 'color-fail',
  };

  const sizes: Record<string, string> = {
    sm: 'size-sm',
    md: 'size-md',
    lg: 'size-lg',
  };
</script>

<div class="confidence-score">
  <div class="score-row">
    <span class="indicator {colors[verdict]}"></span>
    <span class="score-value {sizes[size]} {colors[verdict]}">{score}%</span>
    <span class="score-label">confidence</span>
  </div>

  {#if details}
    <div class="details">
      {#each Object.entries(details) as [engine, result]}
        {#if !result.error}
          <span class="engine-result">{engine}: {(result.similarity * 100).toFixed(1)}%</span>
        {/if}
      {/each}
    </div>
  {/if}
</div>

<style>
  .confidence-score {
    display: flex;
    flex-direction: column;
  }

  .score-row {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .indicator {
    width: 0.75rem;
    height: 0.75rem;
    border-radius: 50%;
  }

  .indicator.color-pass {
    background-color: #22c55e;
  }

  .indicator.color-warn {
    background-color: #eab308;
  }

  .indicator.color-fail {
    background-color: #ef4444;
  }

  .score-value {
    font-weight: 700;
  }

  .score-value.color-pass {
    color: #22c55e;
  }

  .score-value.color-warn {
    color: #eab308;
  }

  .score-value.color-fail {
    color: #ef4444;
  }

  .score-value.size-sm {
    font-size: 0.875rem;
  }

  .score-value.size-md {
    font-size: 1.25rem;
  }

  .score-value.size-lg {
    font-size: 1.875rem;
  }

  .score-label {
    font-size: 0.75rem;
    color: #6b7280;
  }

  .details {
    margin-top: 0.25rem;
    font-size: 0.75rem;
    color: #9ca3af;
  }

  .engine-result {
    margin-right: 0.5rem;
  }
</style>
