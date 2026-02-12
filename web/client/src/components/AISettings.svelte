<script lang="ts">
  import type { AIProviderStatus, VRTConfig } from '../lib/api';

  let {
    config,
    providerStatuses = null,
  } = $props<{
    config: VRTConfig;
    providerStatuses?: AIProviderStatus[] | null;
  }>();

  const MODEL_PRESETS: Record<string, { label: string; value: string }[]> = {
    anthropic: [
      { label: 'Claude Haiku 4.5', value: 'claude-haiku-4-5-20241022' },
      { label: 'Claude Sonnet 4.5', value: 'claude-sonnet-4-5-20250929' },
    ],
    openai: [
      { label: 'GPT-4o Mini', value: 'gpt-4o-mini' },
      { label: 'GPT-4o', value: 'gpt-4o' },
    ],
    openrouter: [
      { label: 'Gemini 3 Flash (Google)', value: 'google/gemini-3-flash-preview' },
      { label: 'Claude Haiku 4.5 (Anthropic)', value: 'anthropic/claude-haiku-4-5' },
      { label: 'GPT-4o Mini (OpenAI)', value: 'openai/gpt-4o-mini' },
    ],
    google: [
      { label: 'Gemini 3 Flash', value: 'gemini-3-flash' },
      { label: 'Gemini 2.5 Flash', value: 'gemini-2.5-flash' },
    ],
  };

  const ENV_HINTS: Record<string, string> = {
    anthropic: 'ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN',
    openai: 'OPENAI_API_KEY',
    openrouter: 'OPENROUTER_API_KEY',
    google: 'GOOGLE_API_KEY',
  };

  const PROVIDER_ORDER: AIProviderStatus['provider'][] = [
    'anthropic',
    'openai',
    'openrouter',
    'google',
  ];

  const PROVIDER_LABELS: Record<AIProviderStatus['provider'], string> = {
    anthropic: 'Anthropic',
    openai: 'OpenAI',
    openrouter: 'OpenRouter',
    google: 'Google',
  };

  let currentProvider = $derived(config.ai?.provider ?? 'anthropic');
  let presets = $derived(MODEL_PRESETS[currentProvider] ?? []);
  let envHint = $derived(ENV_HINTS[currentProvider] ?? '');
  let statusByProvider = $derived(
    new Map((providerStatuses ?? []).map((status) => [status.provider, status]))
  );
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
            manualOnly: false,
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
        <select
          bind:value={config.ai.provider}
          onchange={() => {
            // Clear model when switching providers
            config.ai!.model = undefined;
          }}
        >
          <option value="anthropic">Anthropic (Claude)</option>
          <option value="openai">OpenAI (GPT-4V)</option>
          <option value="openrouter">OpenRouter (Multi-model)</option>
          <option value="google">Google (Gemini)</option>
        </select>
      </label>

      <label>
        Model
        <select
          value={config.ai.model ?? ''}
          onchange={(e) => {
            const val = e.currentTarget.value;
            config.ai!.model = val || undefined;
          }}
        >
          <option value="">Default</option>
          {#each presets as preset}
            <option value={preset.value}>{preset.label}</option>
          {/each}
        </select>
        <input type="text" bind:value={config.ai.model} placeholder="Or type a custom model ID" />
      </label>

      <label>
        API Key
        <input type="password" bind:value={config.ai.apiKey} placeholder="Set via {envHint} env var" />
      </label>

      {#if currentProvider === 'anthropic'}
        <label>
          Auth Token (Claude Max)
          <input type="password" bind:value={config.ai.authToken} placeholder="Set via ANTHROPIC_AUTH_TOKEN env var" />
        </label>
        <p class="hint">Use either API Key (standard) or Auth Token (Claude Max subscription). Auth Token takes effect when no API Key is set.</p>
      {/if}

      {#if currentProvider === 'openrouter'}
        <label>
          Base URL
          <input
            type="text"
            value={config.ai.baseUrl ?? 'https://openrouter.ai/api/v1'}
            onchange={(e) => {
              const val = e.currentTarget.value.trim();
              config.ai!.baseUrl = val === 'https://openrouter.ai/api/v1' ? undefined : val || undefined;
            }}
            placeholder="https://openrouter.ai/api/v1"
          />
        </label>
      {/if}

      <p class="hint env-hint">Env var fallback: {envHint}</p>

      {#if providerStatuses}
        <div class="provider-status-grid">
          <h3>Provider Status</h3>
          {#each PROVIDER_ORDER as provider}
            {@const status = statusByProvider.get(provider)}
            <div
              class="provider-status"
              class:ok={status?.configured}
              class:missing={!status?.configured}
              class:active={status?.active}
            >
              <div class="provider-status-head">
                <span class="provider-name">{PROVIDER_LABELS[provider]}</span>
                <span class="provider-pill">{status?.configured ? 'OK' : 'Missing'}</span>
              </div>
              <div class="provider-status-detail">{status?.detail ?? 'Status unavailable'}</div>
            </div>
          {/each}
        </div>
      {/if}

      <label class="manual-only">
        <input type="checkbox" bind:checked={config.ai.manualOnly} />
        Do not auto-trigger (manual AI triage only)
      </label>

      <h3>Analysis Thresholds</h3>
      <p class="hint">
        {#if config.ai.manualOnly}
          Auto-trigger is disabled. These thresholds will be used again if you re-enable auto-trigger.
        {:else}
          Only analyze diffs that exceed these thresholds (to save API costs)
        {/if}
      </p>
      <fieldset class="form-row thresholds" disabled={config.ai.manualOnly}>
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
      </fieldset>
    </div>
  {/if}
</section>

<style>
  .section {
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 0;
    padding: 1rem;
  }

  .section h2 {
    font-family: var(--font-mono, monospace);
    font-size: 1rem;
    font-weight: 600;
    margin-bottom: 1rem;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  label {
    display: block;
    font-family: var(--font-mono, monospace);
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
    border-radius: 0;
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
    font-family: var(--font-mono, monospace);
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

  .env-hint {
    font-size: 0.65rem;
    opacity: 0.7;
  }

  .provider-status-grid {
    grid-column: 1 / -1;
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: 0.75rem;
  }

  .provider-status-grid h3 {
    grid-column: 1 / -1;
    margin-top: 0;
    margin-bottom: 0.25rem;
  }

  .provider-status {
    border: 1px solid var(--border);
    padding: 0.6rem;
    background: var(--panel-strong);
  }

  .provider-status.ok {
    border-color: rgba(34, 197, 94, 0.45);
  }

  .provider-status.missing {
    border-color: rgba(239, 68, 68, 0.4);
  }

  .provider-status.active {
    box-shadow: inset 0 0 0 1px var(--accent);
  }

  .provider-status-head {
    display: flex;
    justify-content: space-between;
    gap: 0.5rem;
    margin-bottom: 0.35rem;
  }

  .provider-name {
    font-size: 0.75rem;
    font-family: var(--font-mono, monospace);
    color: var(--text-strong);
  }

  .provider-pill {
    font-size: 0.65rem;
    font-family: var(--font-mono, monospace);
    color: var(--text-muted);
  }

  .provider-status-detail {
    font-size: 0.68rem;
    color: var(--text-muted);
    line-height: 1.35;
  }

  .manual-only {
    grid-column: 1 / -1;
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .manual-only input {
    width: auto;
    margin: 0;
  }

  .form-row {
    grid-column: 1 / -1;
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 1rem;
  }

  .thresholds {
    border: 0;
    padding: 0;
    margin: 0;
    min-inline-size: 0;
  }

  .value {
    font-family: var(--font-mono, monospace);
    font-size: 0.75rem;
    color: var(--accent);
  }

  .thresholds[disabled] {
    opacity: 0.55;
  }
</style>
