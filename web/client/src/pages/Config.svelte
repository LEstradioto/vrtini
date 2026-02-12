<script lang="ts">
  import {
    APIError,
    analyze,
    config,
    projects,
    type AIProviderStatus,
    type Project,
    type VRTConfig,
  } from '../lib/api';
  import { getErrorMessage } from '../lib/errors';
  import { getAppContext } from '../lib/app-context';
  import BrowserList from '../components/BrowserList.svelte';
  import ScenarioList from '../components/ScenarioList.svelte';
  import ScenarioOptionsForm from '../components/ScenarioOptionsForm.svelte';
  import AISettings from '../components/AISettings.svelte';

  const { navigate } = getAppContext();

  let { projectId } = $props<{ projectId: string }>();

  let project = $state<Project | null>(null);
  let configData = $state<VRTConfig | null>(null);
  let loading = $state(true);
  let saving = $state(false);
  let error = $state<string | null>(null);
  let success = $state<string | null>(null);
  let saveState = $state<'idle' | 'dirty' | 'saving' | 'saved' | 'error'>('idle');
  let configIssues = $state<Array<{ path: string; message: string }>>([]);
  let showScenarioDefaults = $state(false);
  let providerStatuses = $state<AIProviderStatus[] | null>(null);
  let lastSavedSnapshot = $state<string | null>(null);
  let autosaveEnabled = $state(false);
  let suppressAutosave = $state(false);
  let saveRevision = $state(0);

  const AUTO_SAVE_DEBOUNCE_MS = 700;
  const VALID_AI_PROVIDERS = new Set(['anthropic', 'openai', 'openrouter', 'google']);
  const DEFAULT_AI = {
    enabled: false,
    provider: 'anthropic',
    manualOnly: false,
    analyzeThreshold: { maxPHashSimilarity: 0.95, maxSSIM: 0.98, minPixelDiff: 0.1 },
    autoApprove: { enabled: false, rules: [] as unknown[] },
  } as const;

  function cloneConfig<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
  }

  function normalizeConfigForEditor(input: unknown): VRTConfig | null {
    if (!input || typeof input !== 'object') return null;
    const source = cloneConfig(input as Record<string, unknown>) as Record<string, unknown>;

    if (typeof source.baselineDir !== 'string') source.baselineDir = '.vrt/baselines';
    if (typeof source.outputDir !== 'string') source.outputDir = '.vrt/output';
    if (typeof source.threshold !== 'number' || !Number.isFinite(source.threshold)) source.threshold = 0.1;
    if (typeof source.disableAnimations !== 'boolean') source.disableAnimations = true;
    if (typeof source.diffColor !== 'string') source.diffColor = '#ff00ff';

    const browsers = Array.isArray(source.browsers) ? source.browsers : [];
    source.browsers = browsers.filter((browser) => {
      if (browser === 'chromium' || browser === 'webkit') return true;
      if (!browser || typeof browser !== 'object') return false;
      const name = (browser as { name?: unknown }).name;
      return name === 'chromium' || name === 'webkit';
    });
    if ((source.browsers as unknown[]).length === 0) {
      source.browsers = ['chromium', 'webkit'];
    }

    const viewports = Array.isArray(source.viewports) ? source.viewports : [];
    source.viewports = viewports
      .filter((viewport): viewport is { name: string; width: number; height: number } => {
        if (!viewport || typeof viewport !== 'object') return false;
        const rec = viewport as { name?: unknown; width?: unknown; height?: unknown };
        return (
          typeof rec.name === 'string' &&
          typeof rec.width === 'number' &&
          Number.isFinite(rec.width) &&
          typeof rec.height === 'number' &&
          Number.isFinite(rec.height)
        );
      })
      .map((viewport) => ({
        name: viewport.name,
        width: viewport.width,
        height: viewport.height,
      }));
    if ((source.viewports as unknown[]).length === 0) {
      source.viewports = [
        { name: 'desktop', width: 1920, height: 1080 },
        { name: 'tablet', width: 1024, height: 768 },
        { name: 'mobile', width: 375, height: 667 },
      ];
    }

    const scenarios = Array.isArray(source.scenarios) ? source.scenarios : [];
    source.scenarios = scenarios.filter((scenario) => {
      if (!scenario || typeof scenario !== 'object') return false;
      const rec = scenario as { name?: unknown; url?: unknown };
      return typeof rec.name === 'string' && typeof rec.url === 'string';
    });

    const aiRaw = source.ai;
    if (aiRaw && typeof aiRaw === 'object') {
      const ai = aiRaw as Record<string, unknown>;
      const thresholdRaw =
        ai.analyzeThreshold && typeof ai.analyzeThreshold === 'object'
          ? (ai.analyzeThreshold as Record<string, unknown>)
          : {};
      const autoApproveRaw =
        ai.autoApprove && typeof ai.autoApprove === 'object'
          ? (ai.autoApprove as Record<string, unknown>)
          : {};
      const provider =
        typeof ai.provider === 'string' && VALID_AI_PROVIDERS.has(ai.provider)
          ? ai.provider
          : DEFAULT_AI.provider;

      source.ai = {
        enabled: ai.enabled === true,
        provider,
        apiKey: typeof ai.apiKey === 'string' ? ai.apiKey : undefined,
        authToken: typeof ai.authToken === 'string' ? ai.authToken : undefined,
        model: typeof ai.model === 'string' ? ai.model : undefined,
        baseUrl: typeof ai.baseUrl === 'string' ? ai.baseUrl : undefined,
        manualOnly: ai.manualOnly === true,
        analyzeThreshold: {
          maxPHashSimilarity:
            typeof thresholdRaw.maxPHashSimilarity === 'number'
              ? thresholdRaw.maxPHashSimilarity
              : DEFAULT_AI.analyzeThreshold.maxPHashSimilarity,
          maxSSIM:
            typeof thresholdRaw.maxSSIM === 'number'
              ? thresholdRaw.maxSSIM
              : DEFAULT_AI.analyzeThreshold.maxSSIM,
          minPixelDiff:
            typeof thresholdRaw.minPixelDiff === 'number'
              ? thresholdRaw.minPixelDiff
              : DEFAULT_AI.analyzeThreshold.minPixelDiff,
        },
        autoApprove: {
          enabled: autoApproveRaw.enabled === true,
          rules: Array.isArray(autoApproveRaw.rules) ? autoApproveRaw.rules : [],
        },
      };
    } else if (aiRaw !== undefined) {
      source.ai = cloneConfig(DEFAULT_AI);
    }

    if (!source.scenarioDefaults || typeof source.scenarioDefaults !== 'object') {
      source.scenarioDefaults = {};
    }

    return source as unknown as VRTConfig;
  }

  function applyServerConfig(next: VRTConfig): void {
    suppressAutosave = true;
    const cloned = cloneConfig(next);
    configData = cloned;
    lastSavedSnapshot = JSON.stringify(cloned);
    queueMicrotask(() => {
      suppressAutosave = false;
    });
  }

  function readConfigIssues(err: unknown): Array<{ path: string; message: string }> {
    if (err instanceof APIError && Array.isArray(err.issues)) {
      return err.issues.filter(
        (issue): issue is { path: string; message: string } =>
          !!issue && typeof issue.path === 'string' && typeof issue.message === 'string'
      );
    }
    return [];
  }

  async function saveSnapshot(snapshot: string, opts: { manual: boolean; revision: number }) {
    try {
      saving = true;
      saveState = 'saving';
      error = null;
      configIssues = [];

      const parsed = JSON.parse(snapshot) as VRTConfig;
      const result = await config.save(projectId, parsed);

      if (opts.revision !== saveRevision && !opts.manual) return;

      if (opts.manual) {
        applyServerConfig(result.config);
      } else {
        // Keep autosave stable: treat exactly what was sent as the saved snapshot.
        // Avoid rewriting form state here, which can trigger another autosave pass.
        lastSavedSnapshot = snapshot;
      }
      saveState = 'saved';
      success = opts.manual ? 'Config saved successfully' : 'Autosaved';
      setTimeout(() => {
        if (saveState === 'saved') success = null;
      }, 1800);
    } catch (err) {
      if (opts.revision !== saveRevision && !opts.manual) return;
      saveState = 'error';
      configIssues = readConfigIssues(err);
      error = getErrorMessage(err, 'Failed to save config');
      success = null;
    } finally {
      if (opts.revision === saveRevision || opts.manual) {
        saving = false;
      }
    }
  }

  async function loadConfig() {
    try {
      loading = true;
      autosaveEnabled = false;
      error = null;
      success = null;
      configIssues = [];
      const [projRes, configRes, providerStatusRes] = await Promise.all([
        projects.get(projectId),
        config.get(projectId),
        analyze.providerStatus(projectId).catch(() => null),
      ]);
      project = projRes.project;
      const editableConfig = normalizeConfigForEditor(configRes.valid ? configRes.config : configRes.raw);
      if (!editableConfig) {
        configData = null;
        lastSavedSnapshot = null;
        saveState = 'error';
        configIssues = configRes.errors ?? [];
        error =
          'Config file is invalid JSON or has unsupported structure. Fix the file manually, then reload.';
        return;
      }

      applyServerConfig(editableConfig);
      providerStatuses = providerStatusRes?.providers ?? null;
      saveRevision = 0;
      if (configRes.valid) {
        saveState = 'saved';
        success = null;
      } else {
        saveState = 'error';
        configIssues = configRes.errors ?? [];
        error = 'Config has validation issues. Fix highlighted fields and save to recover.';
      }

      if (configData.scenarioDefaults && Object.keys(configData.scenarioDefaults).length > 0) {
        showScenarioDefaults = true;
      }
    } catch (err) {
      saveState = 'error';
      error = getErrorMessage(err, 'Failed to load config');
    } finally {
      loading = false;
      autosaveEnabled = true;
    }
  }

  async function saveConfig(manual = true) {
    if (!configData) return;
    const snapshot = JSON.stringify(configData);
    saveRevision += 1;
    await saveSnapshot(snapshot, { manual, revision: saveRevision });
  }

  function addViewport() {
    if (!configData) return;
    configData.viewports = [
      ...configData.viewports,
      { name: 'new-viewport', width: 1280, height: 720 },
    ];
  }

  function removeViewport(index: number) {
    if (!configData) return;
    configData.viewports = configData.viewports.filter((_, i) => i !== index);
  }

  async function deleteProject() {
    const confirmed = confirm(
      'Remove this project from vrtini?\n\n' +
      '• The project will be removed from the dashboard\n' +
      '• All baseline, test, and diff images will be KEPT on disk\n' +
      '• You can re-add the project later'
    );
    if (!confirmed) return;

    try {
      await projects.delete(projectId);
      navigate('/');
    } catch (err) {
      error = getErrorMessage(err, 'Failed to remove project');
    }
  }

  $effect(() => {
    loadConfig();
  });

  $effect(() => {
    if (!autosaveEnabled || suppressAutosave || loading || !configData || !lastSavedSnapshot) return;
    const snapshot = JSON.stringify(configData);
    if (snapshot === lastSavedSnapshot) return;

    saveState = 'dirty';
    success = null;
    const revision = saveRevision + 1;
    saveRevision = revision;

    const handle = setTimeout(() => {
      void saveSnapshot(snapshot, { manual: false, revision });
    }, AUTO_SAVE_DEBOUNCE_MS);

    return () => clearTimeout(handle);
  });
</script>

<div class="config-page">
  <div class="header">
    <div class="header-title">
      <button class="back-btn" onclick={() => navigate(`/project/${projectId}`)} title="Back to project">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
      </button>
      <div>
        <h1>Configuration</h1>
        {#if project}
          <p class="subtitle">{project.name}</p>
        {/if}
        <p class="save-state save-state-{saveState}">
          {#if saveState === 'saving'}
            Saving changes...
          {:else if saveState === 'dirty'}
            Unsaved changes
          {:else if saveState === 'saved'}
            All changes saved
          {:else if saveState === 'error'}
            Save failed
          {:else}
            Ready
          {/if}
        </p>
      </div>
    </div>
    <button class="btn primary" onclick={() => saveConfig(true)} disabled={saving || loading}>
      {saving ? 'Saving...' : 'Save Now'}
    </button>
  </div>

  {#if error}
    <div class="error">
      <div>{error}</div>
      {#if configIssues.length > 0}
        <ul class="issue-list">
          {#each configIssues as issue}
            <li><code>{issue.path || '<root>'}</code>: {issue.message}</li>
          {/each}
        </ul>
      {/if}
    </div>
  {/if}

  {#if success}
    <div class="success">{success}</div>
  {/if}

  {#if loading}
    <div class="loading">Loading config...</div>
  {:else if configData}
    <div class="sections">
      <!-- Paths Section -->
      <section class="section">
        <h2>Paths</h2>
        <div class="form-row">
          <label>
            Baseline Directory
            <input type="text" bind:value={configData.baselineDir} />
          </label>
          <label>
            Output Directory
            <input type="text" bind:value={configData.outputDir} />
          </label>
        </div>
      </section>

      <!-- Browsers Section -->
      <BrowserList bind:browsers={configData.browsers} />

      <!-- Viewports Section -->
      <section class="section">
        <h2>
          Viewports
          <button class="btn small" onclick={addViewport}>+ Add</button>
        </h2>
        <div class="viewport-list">
          {#each configData.viewports as viewport, i}
            <div class="viewport-item">
              <input type="text" bind:value={viewport.name} placeholder="Name" />
              <input type="number" bind:value={viewport.width} placeholder="Width" />
              <span>x</span>
              <input type="number" bind:value={viewport.height} placeholder="Height" />
              <button class="btn small danger" onclick={() => removeViewport(i)}>x</button>
            </div>
          {/each}
        </div>
      </section>

      <!-- Settings Section -->
      <section class="section">
        <h2>Settings</h2>
        <div class="form-row">
          <label>
            Threshold (0-1)
            <input type="range" min="0" max="1" step="0.01" bind:value={configData.threshold} />
            <span class="value">{configData.threshold}</span>
          </label>
          <label>
            Max Diff % (tolerance)
            <input
              type="number"
              min="0"
              step="0.01"
              value={configData.diffThreshold?.maxDiffPercentage ?? ''}
              onchange={(e) => {
                const value = parseFloat(e.currentTarget.value);
                if (!configData.diffThreshold) configData.diffThreshold = {};
                if (Number.isNaN(value)) {
                  delete configData.diffThreshold.maxDiffPercentage;
                } else {
                  configData.diffThreshold.maxDiffPercentage = value;
                }
              }}
            />
            <span class="hint-inline">Allow small % diffs to pass</span>
          </label>
          <label>
            Max Diff Pixels
            <input
              type="number"
              min="0"
              step="1"
              value={configData.diffThreshold?.maxDiffPixels ?? ''}
              onchange={(e) => {
                const value = parseInt(e.currentTarget.value);
                if (!configData.diffThreshold) configData.diffThreshold = {};
                if (Number.isNaN(value)) {
                  delete configData.diffThreshold.maxDiffPixels;
                } else {
                  configData.diffThreshold.maxDiffPixels = value;
                }
              }}
            />
            <span class="hint-inline">Allow small pixel diffs to pass</span>
          </label>
          <label>
            Diff Color
            <input type="color" bind:value={configData.diffColor} />
          </label>
          <label>
            Concurrency
            <input
              type="number"
              min="1"
              max="20"
              value={configData.concurrency ?? 5}
              onchange={(e) => configData!.concurrency = parseInt(e.currentTarget.value) || 5}
            />
            <span class="hint-inline">Parallel pages (1-20)</span>
          </label>
          <label class="checkbox">
            <input type="checkbox" bind:checked={configData.disableAnimations} />
            Disable Animations
          </label>
        </div>
      </section>

      <!-- Scenario Defaults Section -->
      <section class="section">
        <h2>
          Scenario Defaults
          <button class="btn small" onclick={() => showScenarioDefaults = !showScenarioDefaults}>
            {showScenarioDefaults ? 'Hide' : 'Show'}
          </button>
        </h2>
        <p class="hint">Default options applied to all scenarios (can be overridden per scenario)</p>

        {#if showScenarioDefaults}
          <div class="defaults-form">
            <ScenarioOptionsForm
              options={configData.scenarioDefaults ??= {}}
            />
          </div>
        {/if}
      </section>

      <!-- Scenarios Section -->
      <ScenarioList bind:scenarios={configData.scenarios} />

      <!-- AI Settings Section -->
      <AISettings projectId={projectId} config={configData} providerStatuses={providerStatuses} />

      <!-- Remove Project -->
      <div class="danger-zone">
        <button class="btn-text-danger" onclick={deleteProject}>
          Remove project from list
        </button>
      </div>
    </div>
  {:else}
    <div class="invalid-config">
      Config cannot be loaded into the form editor.
      {#if configIssues.length > 0}
        Check the validation errors above, fix the JSON file, and reload.
      {:else}
        The config file may be invalid JSON.
      {/if}
    </div>
  {/if}
</div>

<style>
  .config-page {
    max-width: 900px;
    margin: 0 auto;
    font-family: var(--font-body);
  }

  .header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 1.5rem;
  }

  .header-title {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .back-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    background: none;
    border: 1px solid var(--border);
    color: var(--text-muted);
    cursor: pointer;
    transition: border-color 0.15s, color 0.15s;
  }

  .back-btn:hover {
    border-color: var(--accent);
    color: var(--accent);
  }

  h1 {
    font-family: var(--font-mono);
    font-size: 1.25rem;
    font-weight: 600;
  }

  .subtitle {
    color: var(--text-muted);
    font-family: var(--font-mono);
    font-size: 0.8rem;
    margin-top: 0.25rem;
  }

  .save-state {
    margin-top: 0.35rem;
    font-family: var(--font-mono);
    font-size: 0.68rem;
    letter-spacing: 0.03em;
    text-transform: uppercase;
    color: var(--text-muted);
  }

  .save-state-saving {
    color: #0ea5e9;
  }

  .save-state-dirty {
    color: #f59e0b;
  }

  .save-state-saved {
    color: #22c55e;
  }

  .save-state-error {
    color: #ef4444;
  }

  .btn {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 1rem;
    border: 1px solid var(--border);
    border-radius: 0;
    background: var(--panel-strong);
    color: var(--text-strong);
    font-family: var(--font-mono);
    font-size: 0.8rem;
    cursor: pointer;
    transition: background 0.2s, border-color 0.2s;
    text-transform: lowercase;
  }

  .btn:hover {
    border-color: var(--text-muted);
    background: var(--border);
  }

  .btn.primary {
    background: transparent;
    border-color: var(--accent);
    color: var(--accent);
  }

  .btn.primary:hover {
    background: var(--accent);
    color: var(--bg);
  }

  .btn.small {
    padding: 0.25rem 0.5rem;
    font-size: 0.7rem;
  }

  .btn.danger:hover {
    border-color: #ef4444;
    color: #ef4444;
  }

  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .error {
    background: rgba(239, 68, 68, 0.08);
    border: 1px solid #ef4444;
    border-left: 3px solid #ef4444;
    padding: 0.75rem 1rem;
    border-radius: 0;
    margin-bottom: 1rem;
    font-family: var(--font-mono);
  }

  .issue-list {
    margin: 0.5rem 0 0 1rem;
    padding: 0;
    font-size: 0.78rem;
    color: #fecaca;
  }

  .success {
    background: rgba(34, 197, 94, 0.08);
    border: 1px solid #22c55e;
    border-left: 3px solid #22c55e;
    padding: 0.75rem 1rem;
    border-radius: 0;
    margin-bottom: 1rem;
    font-family: var(--font-mono);
  }

  .loading {
    text-align: center;
    padding: 3rem;
    color: var(--text-muted);
    font-family: var(--font-mono);
  }

  .invalid-config {
    padding: 1rem;
    border: 1px solid #ef4444;
    background: rgba(239, 68, 68, 0.08);
    color: #fecaca;
    font-family: var(--font-mono);
    font-size: 0.8rem;
  }

  .sections {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
  }

  .section {
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 0;
    padding: 1rem;
  }

  .section h2 {
    font-family: var(--font-mono);
    font-size: 0.85rem;
    font-weight: 600;
    margin-bottom: 1rem;
    display: flex;
    justify-content: space-between;
    align-items: center;
    text-transform: lowercase;
    letter-spacing: 0.03em;
    color: var(--text-muted);
  }

  .form-row {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 1rem;
  }

  label {
    display: block;
    font-family: var(--font-mono);
    font-size: 0.75rem;
    color: var(--text-muted);
    text-transform: lowercase;
  }

  input[type="text"],
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
    font-family: var(--font-mono);
    font-size: 0.8rem;
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

  input[type="color"] {
    width: 60px;
    height: 32px;
    padding: 0;
    margin-top: 0.25rem;
    border: 1px solid var(--border);
    border-radius: 0;
    cursor: pointer;
  }

  .value {
    font-family: var(--font-mono);
    font-size: 0.75rem;
    color: var(--accent);
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

  .viewport-list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .viewport-item {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .viewport-item input {
    margin-top: 0;
  }

  .viewport-item input[type="text"] {
    flex: 1;
  }

  .viewport-item input[type="number"] {
    width: 80px;
  }

  .viewport-item span {
    color: var(--text-muted);
    font-family: var(--font-mono);
  }

  .hint {
    font-family: var(--font-mono);
    font-size: 0.7rem;
    color: var(--text-muted);
    margin-top: -0.5rem;
  }

  .hint-inline {
    font-family: var(--font-mono);
    font-size: 0.65rem;
    color: var(--text-muted);
    display: block;
    margin-top: 0.25rem;
  }

  .defaults-form {
    margin-top: 1rem;
    padding-top: 1rem;
    border-top: 1px solid var(--border);
  }

  .danger-zone {
    margin-top: 2rem;
    padding-top: 1rem;
    border-top: 1px solid var(--border);
    text-align: center;
  }

  .btn-text-danger {
    background: none;
    border: none;
    color: var(--text-muted);
    font-family: var(--font-mono);
    font-size: 0.7rem;
    cursor: pointer;
    padding: 0.5rem;
    transition: color 0.2s;
    text-transform: lowercase;
  }

  .btn-text-danger:hover {
    color: #ef4444;
  }
</style>
