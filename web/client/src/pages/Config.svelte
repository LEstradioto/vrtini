<script lang="ts">
  import { analyze, config, projects, type AIProviderStatus, type Project, type VRTConfig } from '../lib/api';
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
  let showScenarioDefaults = $state(false);
  let providerStatuses = $state<AIProviderStatus[] | null>(null);

  async function loadConfig() {
    try {
      loading = true;
      const [projRes, configRes, providerStatusRes] = await Promise.all([
        projects.get(projectId),
        config.get(projectId),
        analyze.providerStatus(projectId).catch(() => null),
      ]);
      project = projRes.project;
      configData = JSON.parse(JSON.stringify(configRes.config));
      providerStatuses = providerStatusRes?.providers ?? null;

      if (configData.scenarioDefaults && Object.keys(configData.scenarioDefaults).length > 0) {
        showScenarioDefaults = true;
      }
    } catch (err) {
      error = getErrorMessage(err, 'Failed to load config');
    } finally {
      loading = false;
    }
  }

  async function saveConfig() {
    if (!configData) return;

    try {
      saving = true;
      error = null;
      success = null;
      await config.save(projectId, configData);
      success = 'Config saved successfully';
      setTimeout(() => (success = null), 3000);
    } catch (err) {
      error = getErrorMessage(err, 'Failed to save config');
    } finally {
      saving = false;
    }
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
      </div>
    </div>
    <button class="btn primary" onclick={saveConfig} disabled={saving || loading}>
      {saving ? 'Saving...' : 'Save Config'}
    </button>
  </div>

  {#if error}
    <div class="error">{error}</div>
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
      <AISettings config={configData} providerStatuses={providerStatuses} />

      <!-- Remove Project -->
      <div class="danger-zone">
        <button class="btn-text-danger" onclick={deleteProject}>
          Remove project from list
        </button>
      </div>
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
