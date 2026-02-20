<script lang="ts">
  import { analyze, type AIProviderStatus, type AIProviderValidationResponse, type VRTConfig } from '../lib/api';

  let {
    projectId,
    config,
    providerStatuses = null,
  } = $props<{
    projectId: string;
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
  const OPENROUTER_DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1';

  type AutoApproveCategory = 'cosmetic' | 'noise' | 'content_change' | 'layout_shift' | 'regression';
  type AutoApproveSeverity = 'info' | 'warning' | 'critical';
  type AutoApproveAction = 'approve' | 'flag' | 'reject';
  interface AutoApproveCondition {
    categories?: AutoApproveCategory[];
    maxSeverity?: AutoApproveSeverity;
    minConfidence?: number;
    maxPixelDiff?: number;
    minSSIM?: number;
    minPHash?: number;
  }
  interface AutoApproveRule {
    condition: AutoApproveCondition;
    action: AutoApproveAction;
  }

  const AUTO_APPROVE_CATEGORIES: AutoApproveCategory[] = [
    'cosmetic',
    'noise',
    'content_change',
    'layout_shift',
    'regression',
  ];

  let currentProvider = $derived(config.ai?.provider ?? 'anthropic');
  let presets = $derived(MODEL_PRESETS[currentProvider] ?? []);
  let envHint = $derived(ENV_HINTS[currentProvider] ?? '');
  let statusByProvider = $derived(
    new Map((providerStatuses ?? []).map((status) => [status.provider, status]))
  );
  let autoApproveRules = $derived.by(() => {
    const rules = config.ai?.autoApprove?.rules;
    return Array.isArray(rules) ? (rules as AutoApproveRule[]) : [];
  });

  let providerValidation = $state<{
    state: 'idle' | 'checking' | 'valid' | 'invalid';
    message: string;
  }>({
    state: 'idle',
    message: 'Enter a credential to validate.',
  });
  // Non-reactive request token to prevent self-triggering validation loops.
  let validationRevision = 0;
  const VALIDATION_DEBOUNCE_MS = 500;

  function parseOptionalNumber(value: string): number | undefined {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  function ensureAutoApproveConfig(): void {
    if (!config.ai) return;
    if (!config.ai.autoApprove || typeof config.ai.autoApprove !== 'object') {
      config.ai.autoApprove = { enabled: false, rules: [] };
    }
    if (!Array.isArray(config.ai.autoApprove.rules)) {
      config.ai.autoApprove.rules = [];
    }
  }

  function addAutoApproveRule(): void {
    ensureAutoApproveConfig();
    if (!config.ai) return;
    const rules = Array.isArray(config.ai.autoApprove!.rules)
      ? (config.ai.autoApprove!.rules as AutoApproveRule[])
      : [];
    config.ai.autoApprove!.rules = [...rules, { condition: {}, action: 'flag' }];
  }

  function removeAutoApproveRule(index: number): void {
    ensureAutoApproveConfig();
    if (!config.ai) return;
    const rules = Array.isArray(config.ai.autoApprove!.rules)
      ? (config.ai.autoApprove!.rules as AutoApproveRule[])
      : [];
    config.ai.autoApprove!.rules = rules.filter((_, i) => i !== index);
  }

  function updateRuleAction(index: number, action: AutoApproveAction): void {
    ensureAutoApproveConfig();
    if (!config.ai) return;
    const rules = Array.isArray(config.ai.autoApprove!.rules)
      ? (config.ai.autoApprove!.rules as AutoApproveRule[])
      : [];
    const target = rules[index];
    if (!target) return;
    rules[index] = { ...target, action };
    config.ai.autoApprove!.rules = [...rules];
  }

  function updateRuleSeverity(index: number, value: string): void {
    ensureAutoApproveConfig();
    if (!config.ai) return;
    const rules = Array.isArray(config.ai.autoApprove!.rules)
      ? (config.ai.autoApprove!.rules as AutoApproveRule[])
      : [];
    const target = rules[index];
    if (!target) return;
    const condition = { ...(target.condition ?? {}) };
    if (!value) delete condition.maxSeverity;
    else condition.maxSeverity = value as AutoApproveSeverity;
    rules[index] = { ...target, condition };
    config.ai.autoApprove!.rules = [...rules];
  }

  function updateRuleNumber(
    index: number,
    key: 'minConfidence' | 'maxPixelDiff' | 'minSSIM' | 'minPHash',
    value: string
  ): void {
    ensureAutoApproveConfig();
    if (!config.ai) return;
    const rules = Array.isArray(config.ai.autoApprove!.rules)
      ? (config.ai.autoApprove!.rules as AutoApproveRule[])
      : [];
    const target = rules[index];
    if (!target) return;
    const condition = { ...(target.condition ?? {}) };
    const parsed = parseOptionalNumber(value);
    if (parsed === undefined) delete condition[key];
    else condition[key] = parsed;
    rules[index] = { ...target, condition };
    config.ai.autoApprove!.rules = [...rules];
  }

  function toggleRuleCategory(index: number, category: AutoApproveCategory, enabled: boolean): void {
    ensureAutoApproveConfig();
    if (!config.ai) return;
    const rules = Array.isArray(config.ai.autoApprove!.rules)
      ? (config.ai.autoApprove!.rules as AutoApproveRule[])
      : [];
    const target = rules[index];
    if (!target) return;
    const condition = { ...(target.condition ?? {}) };
    const current = new Set(condition.categories ?? []);
    if (enabled) current.add(category);
    else current.delete(category);
    condition.categories = [...current];
    if (condition.categories.length === 0) delete condition.categories;
    rules[index] = { ...target, condition };
    config.ai.autoApprove!.rules = [...rules];
  }

  function buildValidationPayload() {
    return {
      provider: currentProvider,
      apiKey: config.ai?.apiKey?.trim() || undefined,
      authToken: config.ai?.authToken?.trim() || undefined,
      baseUrl: config.ai?.baseUrl?.trim() || undefined,
      model: config.ai?.model?.trim() || undefined,
    } as const;
  }

  function getValidationClass(): string {
    if (providerValidation.state === 'valid') return 'input-valid';
    if (providerValidation.state === 'invalid') return 'input-invalid';
    if (providerValidation.state === 'checking') return 'input-checking';
    return '';
  }

  $effect(() => {
    if (!config.ai?.enabled) {
      providerValidation = { state: 'idle', message: 'Enable AI analysis to validate credentials.' };
      return;
    }

    currentProvider;
    config.ai?.apiKey;
    config.ai?.authToken;
    config.ai?.baseUrl;
    config.ai?.model;

    const payload = buildValidationPayload();
    if (!payload.apiKey && !(payload.provider === 'anthropic' && payload.authToken)) {
      providerValidation = {
        state: 'idle',
        message: `Enter ${currentProvider === 'anthropic' ? 'API key or auth token' : 'API key'} to validate.`,
      };
      return;
    }

    const revision = validationRevision + 1;
    validationRevision = revision;
    providerValidation = { state: 'checking', message: 'Validating credential...' };

    const handle = setTimeout(async () => {
      try {
        const result: AIProviderValidationResponse = await analyze.validateProvider(projectId, payload);
        if (revision !== validationRevision) return;
        providerValidation = {
          state: result.valid ? 'valid' : 'invalid',
          message: result.message,
        };
      } catch (err) {
        if (revision !== validationRevision) return;
        providerValidation = {
          state: 'invalid',
          message: err instanceof Error ? err.message : 'Credential validation failed.',
        };
      }
    }, VALIDATION_DEBOUNCE_MS);

    return () => clearTimeout(handle);
  });
</script>

<section class="section">
  <h2>AI Analysis (Optional)</h2>
  <details class="flow-explainer">
    <summary>How AI triage and Smart Pass work</summary>
    <div class="flow-body">
      <p>
        1) Cross compare computes technical signals (pixel diff, SSIM, pHash, DOM/text snapshot).
      </p>
      <p>
        2) Confidence is calculated from these signals, then AI triage can adjust this confidence up/down based on visual reasoning.
      </p>
      <p>
        3) Smart Pass is recomputed after AI analysis. It is not a blind auto-approve, it is a review shortcut candidate.
      </p>
      <p>
        4) Full justification is shown in fullscreen diagnostics (Smart Pass reason + AI recommendation details).
      </p>
    </div>
  </details>
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
        <input
          type="password"
          class={getValidationClass()}
          bind:value={config.ai.apiKey}
          placeholder="Set via {envHint} env var"
        />
      </label>

      {#if currentProvider === 'anthropic'}
        <label>
          Auth Token (Claude Max)
          <input
            type="password"
            class={getValidationClass()}
            bind:value={config.ai.authToken}
            placeholder="Set via ANTHROPIC_AUTH_TOKEN env var"
          />
        </label>
        <p class="hint">Use either API Key (standard) or Auth Token (Claude Max subscription). Auth Token takes effect when no API Key is set.</p>
      {/if}

      <label>
        Base URL (optional)
        <input
          type="text"
          value={config.ai.baseUrl ?? (currentProvider === 'openrouter' ? OPENROUTER_DEFAULT_BASE_URL : '')}
          onchange={(e) => {
            const val = e.currentTarget.value.trim();
            if (!val) {
              config.ai!.baseUrl = undefined;
            } else if (currentProvider === 'openrouter' && val === OPENROUTER_DEFAULT_BASE_URL) {
              config.ai!.baseUrl = undefined;
            } else {
              config.ai!.baseUrl = val;
            }
          }}
          placeholder={currentProvider === 'openrouter' ? OPENROUTER_DEFAULT_BASE_URL : 'Provider default URL'}
        />
      </label>

      <p class="hint env-hint">Env var fallback: {envHint}</p>
      <p class="hint key-status key-status-{providerValidation.state}">
        {providerValidation.message}
      </p>

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

      <div class="auto-approve-head">
        <h3>Auto-Approve Rules</h3>
        <button class="btn small" onclick={addAutoApproveRule} disabled={!(config.ai.autoApprove?.enabled ?? false)}>
          + Add Rule
        </button>
      </div>
      <label class="manual-only">
        <input
          type="checkbox"
          checked={config.ai.autoApprove?.enabled ?? false}
          onchange={(e) => {
            ensureAutoApproveConfig();
            if (!config.ai) return;
            config.ai.autoApprove!.enabled = e.currentTarget.checked;
          }}
        />
        Enable automatic actions from AI analysis rules
      </label>
      <p class="hint">
        Rules are evaluated top-to-bottom for each AI analysis result. First matching rule applies its action.
      </p>

      {#if config.ai.autoApprove?.enabled}
        <div class="auto-rules">
          {#if autoApproveRules.length === 0}
            <p class="hint empty-rules">No rules configured yet.</p>
          {:else}
            {#each autoApproveRules as rule, index}
              <div class="rule-card">
                <div class="rule-head">
                  <span class="rule-title">Rule {index + 1}</span>
                  <button class="btn small danger" onclick={() => removeAutoApproveRule(index)}>Remove</button>
                </div>

                <div class="rule-grid">
                  <label>
                    Action
                    <select
                      value={rule.action}
                      onchange={(e) => updateRuleAction(index, e.currentTarget.value as AutoApproveAction)}
                    >
                      <option value="approve">approve</option>
                      <option value="flag">flag</option>
                      <option value="reject">reject</option>
                    </select>
                  </label>

                  <label>
                    Max Severity
                    <select
                      value={rule.condition?.maxSeverity ?? ''}
                      onchange={(e) => updateRuleSeverity(index, e.currentTarget.value)}
                    >
                      <option value="">Any</option>
                      <option value="info">info</option>
                      <option value="warning">warning</option>
                      <option value="critical">critical</option>
                    </select>
                  </label>

                  <label>
                    Min Confidence (0-1)
                    <input
                      type="number"
                      min="0"
                      max="1"
                      step="0.01"
                      value={rule.condition?.minConfidence ?? ''}
                      onchange={(e) => updateRuleNumber(index, 'minConfidence', e.currentTarget.value)}
                    />
                  </label>

                  <label>
                    Max Pixel Diff %
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={rule.condition?.maxPixelDiff ?? ''}
                      onchange={(e) => updateRuleNumber(index, 'maxPixelDiff', e.currentTarget.value)}
                    />
                  </label>

                  <label>
                    Min SSIM (0-1)
                    <input
                      type="number"
                      min="0"
                      max="1"
                      step="0.01"
                      value={rule.condition?.minSSIM ?? ''}
                      onchange={(e) => updateRuleNumber(index, 'minSSIM', e.currentTarget.value)}
                    />
                  </label>

                  <label>
                    Min pHash (0-1)
                    <input
                      type="number"
                      min="0"
                      max="1"
                      step="0.01"
                      value={rule.condition?.minPHash ?? ''}
                      onchange={(e) => updateRuleNumber(index, 'minPHash', e.currentTarget.value)}
                    />
                  </label>
                </div>

                <div class="category-block">
                  <span class="category-title">Categories</span>
                  <div class="category-grid">
                    {#each AUTO_APPROVE_CATEGORIES as category}
                      <label class="checkbox category-checkbox">
                        <input
                          type="checkbox"
                          checked={rule.condition?.categories?.includes(category) ?? false}
                          onchange={(e) => toggleRuleCategory(index, category, e.currentTarget.checked)}
                        />
                        {category}
                      </label>
                    {/each}
                  </div>
                </div>
              </div>
            {/each}
          {/if}
        </div>
      {/if}
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

  .flow-explainer {
    margin: 0 0 0.8rem;
    border: 1px solid var(--border);
    background: var(--panel-strong);
  }

  .flow-explainer summary {
    cursor: pointer;
    list-style: none;
    padding: 0.55rem 0.65rem;
    font-family: var(--font-mono, monospace);
    font-size: 0.75rem;
    letter-spacing: 0.03em;
    color: var(--text);
  }

  .flow-explainer summary::-webkit-details-marker {
    display: none;
  }

  .flow-body {
    padding: 0 0.65rem 0.65rem;
    display: grid;
    gap: 0.35rem;
  }

  .flow-body p {
    margin: 0;
    font-size: 0.75rem;
    color: var(--text-muted);
    line-height: 1.45;
  }

  .btn {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.45rem 0.8rem;
    border: 1px solid var(--border);
    border-radius: 0;
    background: var(--panel-strong);
    color: var(--text-strong);
    font-family: var(--font-mono, monospace);
    font-size: 0.76rem;
    cursor: pointer;
    transition: background 0.2s, border-color 0.2s;
    text-transform: lowercase;
  }

  .btn:hover {
    border-color: var(--text-muted);
    background: var(--border);
  }

  .btn.small {
    padding: 0.25rem 0.5rem;
    font-size: 0.7rem;
  }

  .btn.danger:hover {
    border-color: rgba(239, 68, 68, 0.8);
    color: #fecaca;
  }

  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
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

  input.input-valid {
    border-color: rgba(34, 197, 94, 0.75);
    box-shadow: inset 0 0 0 1px rgba(34, 197, 94, 0.35);
  }

  input.input-invalid {
    border-color: rgba(239, 68, 68, 0.75);
    box-shadow: inset 0 0 0 1px rgba(239, 68, 68, 0.35);
  }

  input.input-checking {
    border-color: rgba(14, 165, 233, 0.75);
    box-shadow: inset 0 0 0 1px rgba(14, 165, 233, 0.35);
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

  .key-status {
    margin-top: -0.7rem;
  }

  .key-status-checking {
    color: #38bdf8;
  }

  .key-status-valid {
    color: #22c55e;
  }

  .key-status-invalid {
    color: #ef4444;
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

  .auto-approve-head {
    grid-column: 1 / -1;
    margin-top: 0.75rem;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
  }

  .auto-approve-head h3 {
    margin: 0;
  }

  .auto-rules {
    grid-column: 1 / -1;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .empty-rules {
    margin: 0;
  }

  .rule-card {
    border: 1px solid var(--border);
    background: var(--panel-strong);
    padding: 0.75rem;
  }

  .rule-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    margin-bottom: 0.75rem;
  }

  .rule-title {
    font-family: var(--font-mono, monospace);
    font-size: 0.75rem;
    color: var(--text-strong);
  }

  .rule-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
    gap: 0.65rem;
  }

  .category-block {
    margin-top: 0.85rem;
    padding-top: 0.65rem;
    border-top: 1px solid var(--border);
  }

  .category-title {
    display: block;
    margin-bottom: 0.5rem;
    font-family: var(--font-mono, monospace);
    font-size: 0.7rem;
    color: var(--text-muted);
    text-transform: lowercase;
    letter-spacing: 0.03em;
  }

  .category-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    gap: 0.45rem;
  }

  .category-checkbox {
    font-size: 0.72rem;
  }
</style>
