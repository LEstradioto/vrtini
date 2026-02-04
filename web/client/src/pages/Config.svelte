<script lang="ts">
  import { config, projects, type VRTConfig, type Project } from '../lib/api';

  let { projectId, navigate } = $props<{ projectId: string; navigate: (path: string) => void }>();

  let project = $state<Project | null>(null);
  let configData = $state<VRTConfig | null>(null);
  let loading = $state(true);
  let saving = $state(false);
  let error = $state<string | null>(null);
  let success = $state<string | null>(null);
  let expandedScenario = $state<number | null>(null);
  let showScenarioDefaults = $state(false);

  // Normalize browser config for display
  interface BrowserEntry {
    name: 'chromium' | 'webkit';
    version: string;
    index: number;
  }

  let browserEntries = $derived.by((): BrowserEntry[] => {
    if (!configData) return [];
    return configData.browsers.map((b, index) => {
      if (typeof b === 'string') {
        return { name: b, version: '', index };
      }
      return { name: b.name, version: b.version || '', index };
    });
  });

  // Add a new browser entry
  function addBrowser(name: 'chromium' | 'webkit') {
    if (!configData) return;
    configData.browsers = [...configData.browsers, name];
    configData = { ...configData };
  }

  // Remove a browser entry by index
  function removeBrowser(index: number) {
    if (!configData) return;
    configData.browsers = configData.browsers.filter((_, i) => i !== index);
    configData = { ...configData };
  }

  // Update browser version by index
  function updateBrowserVersion(index: number, version: string) {
    if (!configData) return;
    const entry = configData.browsers[index];
    const name = typeof entry === 'string' ? entry : entry.name;

    if (version.trim()) {
      configData.browsers[index] = { name, version: version.trim() };
    } else {
      configData.browsers[index] = name;
    }
    configData = { ...configData };
  }

  // Helper to parse comma-separated selectors
  function parseSelectors(value: string): string[] {
    return value.split(',').map(s => s.trim()).filter(Boolean);
  }

  // Helper to format selectors for display
  function formatSelectors(selectors?: string[]): string {
    return selectors?.join(', ') || '';
  }

  async function loadConfig() {
    try {
      loading = true;
      const [projRes, configRes] = await Promise.all([
        projects.get(projectId),
        config.get(projectId),
      ]);
      project = projRes.project;
      // Deep clone to ensure reactivity works properly
      configData = JSON.parse(JSON.stringify(configRes.config));

      // Auto-expand scenarioDefaults if it has values
      if (configData.scenarioDefaults && Object.keys(configData.scenarioDefaults).length > 0) {
        showScenarioDefaults = true;
      }
    } catch (err) {
      error = err instanceof Error ? err.message : 'Failed to load config';
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
      error = err instanceof Error ? err.message : 'Failed to save config';
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

  function addScenario() {
    if (!configData) return;
    configData.scenarios = [
      ...configData.scenarios,
      { name: 'new-scenario', url: 'https://example.com' },
    ];
    expandedScenario = configData.scenarios.length - 1;
  }

  function removeScenario(index: number) {
    if (!configData) return;
    configData.scenarios = configData.scenarios.filter((_, i) => i !== index);
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
      error = err instanceof Error ? err.message : 'Failed to remove project';
    }
  }

  $effect(() => {
    loadConfig();
  });
</script>

<div class="config-page">
  <div class="header">
    <div>
      <h1>Configuration</h1>
      {#if project}
        <p class="subtitle">{project.name}</p>
      {/if}
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
      <section class="section">
        <h2>
          Browsers
          <div class="browser-add-btns">
            <button class="btn small" onclick={() => addBrowser('chromium')}>+ Chromium</button>
            <button class="btn small" onclick={() => addBrowser('webkit')}>+ WebKit</button>
          </div>
        </h2>

        {#if browserEntries.length === 0}
          <p class="empty-hint">No browsers configured. Add at least one browser.</p>
        {:else}
          <div class="browser-list">
            {#each browserEntries as entry (entry.index)}
              <div class="browser-item">
                <span class="browser-name">{entry.name === 'chromium' ? 'Chromium' : 'WebKit'}</span>
                <input
                  type="text"
                  class="version-input"
                  value={entry.version}
                  oninput={(e) => updateBrowserVersion(entry.index, e.currentTarget.value)}
                  placeholder="Version (empty = latest)"
                />
                <button
                  class="btn small danger"
                  onclick={() => removeBrowser(entry.index)}
                  title="Remove"
                >
                  x
                </button>
              </div>
            {/each}
          </div>
        {/if}

        <p class="hint">Add multiple versions of the same browser for cross-version comparison (e.g., Chromium 130 + Chromium 93).</p>
      </section>

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
            <label>
              Wait For
              <select
                value={configData.scenarioDefaults?.waitFor ?? ''}
                onchange={(e) => {
                  if (!configData!.scenarioDefaults) configData!.scenarioDefaults = {};
                  const val = e.currentTarget.value;
                  configData!.scenarioDefaults.waitFor = val ? val as 'load' | 'networkidle' | 'domcontentloaded' : undefined;
                }}
              >
                <option value="">Default</option>
                <option value="load">load</option>
                <option value="networkidle">networkidle</option>
                <option value="domcontentloaded">domcontentloaded</option>
              </select>
            </label>
            <label>
              Wait For Selector
              <input
                type="text"
                value={configData.scenarioDefaults?.waitForSelector ?? ''}
                onchange={(e) => {
                  if (!configData!.scenarioDefaults) configData!.scenarioDefaults = {};
                  configData!.scenarioDefaults.waitForSelector = e.currentTarget.value || undefined;
                }}
                placeholder="#element"
              />
            </label>
            <label>
              Wait Timeout (ms)
              <input
                type="number"
                value={configData.scenarioDefaults?.waitForTimeout ?? ''}
                onchange={(e) => {
                  if (!configData!.scenarioDefaults) configData!.scenarioDefaults = {};
                  configData!.scenarioDefaults.waitForTimeout = parseInt(e.currentTarget.value) || undefined;
                }}
              />
            </label>
            <label>
              Selector (capture element)
              <input
                type="text"
                value={configData.scenarioDefaults?.selector ?? ''}
                onchange={(e) => {
                  if (!configData!.scenarioDefaults) configData!.scenarioDefaults = {};
                  configData!.scenarioDefaults.selector = e.currentTarget.value || undefined;
                }}
                placeholder=".main-content"
              />
            </label>
            <label class="checkbox">
              <input
                type="checkbox"
                checked={configData.scenarioDefaults?.fullPage ?? false}
                onchange={(e) => {
                  if (!configData!.scenarioDefaults) configData!.scenarioDefaults = {};
                  configData!.scenarioDefaults.fullPage = e.currentTarget.checked || undefined;
                }}
              />
              Full Page Screenshot
            </label>
            <label>
              Hide Selectors
              <input
                type="text"
                value={formatSelectors(configData.scenarioDefaults?.hideSelectors)}
                onchange={(e) => {
                  if (!configData!.scenarioDefaults) configData!.scenarioDefaults = {};
                  const selectors = parseSelectors(e.currentTarget.value);
                  configData!.scenarioDefaults.hideSelectors = selectors.length ? selectors : undefined;
                }}
                placeholder=".ad, .cookie-banner"
              />
              <span class="hint-inline">Comma-separated (visibility: hidden)</span>
            </label>
            <label>
              Remove Selectors
              <input
                type="text"
                value={formatSelectors(configData.scenarioDefaults?.removeSelectors)}
                onchange={(e) => {
                  if (!configData!.scenarioDefaults) configData!.scenarioDefaults = {};
                  const selectors = parseSelectors(e.currentTarget.value);
                  configData!.scenarioDefaults.removeSelectors = selectors.length ? selectors : undefined;
                }}
                placeholder=".modal, .popup"
              />
              <span class="hint-inline">Comma-separated (display: none)</span>
            </label>
            <label class="full-width">
              Before Screenshot (JS)
              <textarea
                value={configData.scenarioDefaults?.beforeScreenshot ?? ''}
                onchange={(e) => {
                  if (!configData!.scenarioDefaults) configData!.scenarioDefaults = {};
                  configData!.scenarioDefaults.beforeScreenshot = e.currentTarget.value || undefined;
                }}
                rows="3"
                placeholder="await page.click('.close-modal');"
              ></textarea>
            </label>
          </div>
        {/if}
      </section>

      <!-- Scenarios Section -->
      <section class="section">
        <h2>
          Scenarios
          <button class="btn small" onclick={addScenario}>+ Add</button>
        </h2>
        <div class="scenario-list">
          {#each configData.scenarios as scenario, i}
            <div class="scenario-item" class:expanded={expandedScenario === i}>
              <div class="scenario-header" onclick={() => (expandedScenario = expandedScenario === i ? null : i)} onkeydown={(e) => e.key === 'Enter' && (expandedScenario = expandedScenario === i ? null : i)} role="button" tabindex="0">
                <span class="scenario-name">{scenario.name}</span>
                <span class="scenario-url">{scenario.url}</span>
                <button
                  class="btn small danger"
                  onclick={(e) => { e.stopPropagation(); removeScenario(i); }}
                >
                  x
                </button>
              </div>

              {#if expandedScenario === i}
                <div class="scenario-details">
                  <label>
                    Name
                    <input type="text" bind:value={scenario.name} />
                  </label>
                  <label>
                    URL
                    <input type="text" bind:value={scenario.url} />
                  </label>
                  <label>
                    Wait For
                    <select bind:value={scenario.waitFor}>
                      <option value={undefined}>Default</option>
                      <option value="load">load</option>
                      <option value="networkidle">networkidle</option>
                      <option value="domcontentloaded">domcontentloaded</option>
                    </select>
                  </label>
                  <label>
                    Wait For Selector
                    <input type="text" bind:value={scenario.waitForSelector} placeholder="#element" />
                  </label>
                  <label>
                    Wait Timeout (ms)
                    <input type="number" bind:value={scenario.waitForTimeout} />
                  </label>
                  <label>
                    Selector (capture element)
                    <input type="text" bind:value={scenario.selector} placeholder=".main-content" />
                  </label>
                  <label class="checkbox">
                    <input type="checkbox" bind:checked={scenario.fullPage} />
                    Full Page Screenshot
                  </label>
                  <label>
                    Hide Selectors
                    <input
                      type="text"
                      value={formatSelectors(scenario.hideSelectors)}
                      onchange={(e) => {
                        const selectors = parseSelectors(e.currentTarget.value);
                        scenario.hideSelectors = selectors.length ? selectors : undefined;
                      }}
                      placeholder=".ad, .cookie-banner"
                    />
                    <span class="hint-inline">Comma-separated (visibility: hidden)</span>
                  </label>
                  <label>
                    Remove Selectors
                    <input
                      type="text"
                      value={formatSelectors(scenario.removeSelectors)}
                      onchange={(e) => {
                        const selectors = parseSelectors(e.currentTarget.value);
                        scenario.removeSelectors = selectors.length ? selectors : undefined;
                      }}
                      placeholder=".modal, .popup"
                    />
                    <span class="hint-inline">Comma-separated (display: none)</span>
                  </label>
                  <label>
                    Max Diff % (override)
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={scenario.diffThreshold?.maxDiffPercentage ?? ''}
                      onchange={(e) => {
                        const value = parseFloat(e.currentTarget.value);
                        if (!scenario.diffThreshold) scenario.diffThreshold = {};
                        if (Number.isNaN(value)) {
                          delete scenario.diffThreshold.maxDiffPercentage;
                        } else {
                          scenario.diffThreshold.maxDiffPercentage = value;
                        }
                      }}
                    />
                  </label>
                  <label>
                    Max Diff Pixels (override)
                    <input
                      type="number"
                      min="0"
                      step="1"
                      value={scenario.diffThreshold?.maxDiffPixels ?? ''}
                      onchange={(e) => {
                        const value = parseInt(e.currentTarget.value);
                        if (!scenario.diffThreshold) scenario.diffThreshold = {};
                        if (Number.isNaN(value)) {
                          delete scenario.diffThreshold.maxDiffPixels;
                        } else {
                          scenario.diffThreshold.maxDiffPixels = value;
                        }
                      }}
                    />
                  </label>
                  <label class="full-width">
                    Before Screenshot (JS)
                    <textarea bind:value={scenario.beforeScreenshot} rows="3" placeholder="await page.click('.close-modal');"></textarea>
                  </label>
                </div>
              {/if}
            </div>
          {/each}
        </div>
      </section>

      <!-- AI Settings Section -->
      <section class="section">
        <h2>AI Analysis (Optional)</h2>
        <label class="checkbox">
          <input
            type="checkbox"
            checked={configData.ai?.enabled ?? false}
            onchange={(e) => {
              if (!configData!.ai) {
                configData!.ai = {
                  enabled: false,
                  provider: 'anthropic',
                  analyzeThreshold: { maxPHashSimilarity: 0.95, maxSSIM: 0.98, minPixelDiff: 0.1 },
                  autoApprove: { enabled: false, rules: [] },
                };
              }
              configData!.ai.enabled = e.currentTarget.checked;
            }}
          />
          Enable AI Analysis
        </label>

        {#if configData.ai?.enabled}
          <div class="ai-settings">
            <label>
              Provider
              <select bind:value={configData.ai.provider}>
                <option value="anthropic">Anthropic (Claude)</option>
                <option value="openai">OpenAI (GPT-4V)</option>
              </select>
            </label>
            <label>
              API Key
              <input type="password" bind:value={configData.ai.apiKey} placeholder="Set via env var" />
            </label>
            <label>
              Model (optional)
              <input type="text" bind:value={configData.ai.model} placeholder="claude-sonnet-4-20250514" />
            </label>

            <h3>Analysis Thresholds</h3>
            <p class="hint">Only analyze diffs that exceed these thresholds (to save API costs)</p>
            <div class="form-row">
              <label>
                Max pHash Similarity
                <input type="range" min="0" max="1" step="0.01" bind:value={configData.ai.analyzeThreshold.maxPHashSimilarity} />
                <span class="value">{configData.ai.analyzeThreshold.maxPHashSimilarity}</span>
              </label>
              <label>
                Max SSIM
                <input type="range" min="0" max="1" step="0.01" bind:value={configData.ai.analyzeThreshold.maxSSIM} />
                <span class="value">{configData.ai.analyzeThreshold.maxSSIM}</span>
              </label>
              <label>
                Min Pixel Diff %
                <input type="number" min="0" step="0.1" bind:value={configData.ai.analyzeThreshold.minPixelDiff} />
              </label>
            </div>
          </div>
        {/if}
      </section>

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
  }

  .header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 1.5rem;
  }

  h1 {
    font-size: 1.5rem;
    font-weight: 600;
  }

  .subtitle {
    color: var(--text-muted);
    font-size: 0.875rem;
    margin-top: 0.25rem;
  }

  .btn {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 1rem;
    border: none;
    border-radius: 6px;
    background: var(--border);
    color: var(--text-strong);
    font-size: 0.875rem;
    cursor: pointer;
    transition: background 0.2s;
  }

  .btn:hover {
    background: var(--border-soft);
  }

  .btn.primary {
    background: var(--accent);
    color: #fff;
  }

  .btn.primary:hover {
    background: var(--accent-strong);
  }

  .btn.small {
    padding: 0.25rem 0.5rem;
    font-size: 0.75rem;
  }

  .btn.danger:hover {
    background: #ef4444;
  }

  .btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .error {
    background: #7f1d1d;
    border: 1px solid #ef4444;
    padding: 0.75rem 1rem;
    border-radius: 6px;
    margin-bottom: 1rem;
  }

  .success {
    background: #14532d;
    border: 1px solid #22c55e;
    padding: 0.75rem 1rem;
    border-radius: 6px;
    margin-bottom: 1rem;
  }

  .loading {
    text-align: center;
    padding: 3rem;
    color: var(--text-muted);
  }

  .sections {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
  }

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

  .form-row {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 1rem;
  }

  label {
    display: block;
    font-size: 0.8rem;
    color: var(--text-muted);
  }

  input[type="text"],
  input[type="password"],
  input[type="number"],
  select,
  textarea {
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
  select:focus,
  textarea:focus {
    outline: none;
    border-color: var(--accent);
  }

  textarea {
    font-family: monospace;
    resize: vertical;
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
    border-radius: 4px;
    cursor: pointer;
  }

  .value {
    font-family: monospace;
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
  }

  .scenario-list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .scenario-item {
    background: var(--panel-strong);
    border: 1px solid var(--border);
    border-radius: 6px;
    overflow: hidden;
  }

  .scenario-item.expanded {
    border-color: var(--accent);
  }

  .scenario-header {
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 0.75rem;
    cursor: pointer;
  }

  .scenario-header:hover {
    background: var(--panel);
  }

  .scenario-name {
    font-weight: 500;
    min-width: 120px;
  }

  .scenario-url {
    flex: 1;
    color: var(--text-muted);
    font-size: 0.8rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .scenario-details {
    padding: 1rem;
    border-top: 1px solid var(--border);
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1rem;
  }

  .scenario-details label:last-child {
    grid-column: 1 / -1;
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

  .hint-inline {
    font-size: 0.7rem;
    color: var(--text-muted);
    display: block;
    margin-top: 0.25rem;
  }

  .browser-add-btns {
    display: flex;
    gap: 0.5rem;
  }

  .browser-list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    margin-bottom: 0.5rem;
  }

  .browser-item {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.5rem 0.75rem;
    background: var(--panel-strong);
    border: 1px solid var(--border);
    border-radius: 6px;
  }

  .browser-name {
    font-size: 0.875rem;
    font-weight: 500;
    min-width: 80px;
  }

  .version-input {
    flex: 1;
    max-width: 200px;
    margin-top: 0 !important;
  }

  .empty-hint {
    font-size: 0.8rem;
    color: var(--text-muted);
    padding: 1rem;
    text-align: center;
    background: var(--panel-strong);
    border: 1px dashed var(--border);
    border-radius: 6px;
    margin-bottom: 0.5rem;
  }

  .defaults-form {
    margin-top: 1rem;
    padding-top: 1rem;
    border-top: 1px solid var(--border);
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1rem;
  }

  .defaults-form .full-width,
  .scenario-details .full-width {
    grid-column: 1 / -1;
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
    font-size: 0.75rem;
    cursor: pointer;
    padding: 0.5rem;
    transition: color 0.2s;
  }

  .btn-text-danger:hover {
    color: #ef4444;
  }
</style>
