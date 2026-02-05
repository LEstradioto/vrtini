<script lang="ts">
  import type { VRTConfig } from '../lib/api';

  let { config } = $props<{ config: VRTConfig }>();
</script>

<section class="section">
  <h2>AI Analysis (Optional)</h2>
  <label class="checkbox">
    <input
      type="checkbox"
      checked={config.ai?.enabled ?? false}
      onchange={(e) => {
        if (!config.ai) {
          config.ai = {
            enabled: false,
            provider: 'anthropic',
            analyzeThreshold: { maxPHashSimilarity: 0.95, maxSSIM: 0.98, minPixelDiff: 0.1 },
            autoApprove: { enabled: false, rules: [] },
          };
        }
        config.ai.enabled = e.currentTarget.checked;
      }}
    />
    Enable AI Analysis
  </label>

  {#if config.ai?.enabled}
    <div class="ai-settings">
      <label>
        Provider
        <select bind:value={config.ai.provider}>
          <option value="anthropic">Anthropic (Claude)</option>
          <option value="openai">OpenAI (GPT-4V)</option>
        </select>
      </label>
      <label>
        API Key
        <input type="password" bind:value={config.ai.apiKey} placeholder="Set via env var" />
      </label>
      <label>
        Model (optional)
        <input type="text" bind:value={config.ai.model} placeholder="claude-sonnet-4-20250514" />
      </label>

      <h3>Analysis Thresholds</h3>
      <p class="hint">Only analyze diffs that exceed these thresholds (to save API costs)</p>
      <div class="form-row">
        <label>
          Max pHash Similarity
          <input type="range" min="0" max="1" step="0.01" bind:value={config.ai.analyzeThreshold.maxPHashSimilarity} />
          <span class="value">{config.ai.analyzeThreshold.maxPHashSimilarity}</span>
        </label>
        <label>
          Max SSIM
          <input type="range" min="0" max="1" step="0.01" bind:value={config.ai.analyzeThreshold.maxSSIM} />
          <span class="value">{config.ai.analyzeThreshold.maxSSIM}</span>
        </label>
        <label>
          Min Pixel Diff %
          <input type="number" min="0" step="0.1" bind:value={config.ai.analyzeThreshold.minPixelDiff} />
        </label>
      </div>
    </div>
  {/if}
</section>

<style>
  .section {
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 1rem;
  }

  .section h2 {
    font-size: 1rem;
    font-weight: 600;
    margin-bottom: 1rem;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  label {
    display: block;
    font-size: 0.8rem;
    color: var(--text-muted);
  }

  input[type="text"],
  input[type="password"],
  input[type="number"],
  select {
    display: block;
    width: 100%;
    margin-top: 0.25rem;
    padding: 0.5rem;
    background: var(--panel-strong);
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--text);
    font-size: 0.875rem;
  }

  input:focus,
  select:focus {
    outline: none;
    border-color: var(--accent);
  }

  input[type="range"] {
    width: 100%;
    margin-top: 0.25rem;
  }

  .checkbox {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    cursor: pointer;
  }

  .checkbox input {
    width: auto;
    margin: 0;
  }

  .ai-settings {
    margin-top: 1rem;
    padding-top: 1rem;
    border-top: 1px solid var(--border);
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 1rem;
  }

  .ai-settings h3 {
    grid-column: 1 / -1;
    font-size: 0.9rem;
    font-weight: 500;
    margin-top: 1rem;
  }

  .hint {
    grid-column: 1 / -1;
    font-size: 0.75rem;
    color: var(--text-muted);
    margin-top: -0.5rem;
  }

  .form-row {
    grid-column: 1 / -1;
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 1rem;
  }

  .value {
    font-family: monospace;
    font-size: 0.75rem;
    color: var(--accent);
  }
</style>
