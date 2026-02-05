<script lang="ts">
  import type { ScenarioOptions } from '../lib/api';

  let { options, showDiffThreshold = false } = $props<{
    options: ScenarioOptions;
    showDiffThreshold?: boolean;
  }>();

  function parseSelectors(value: string): string[] {
    return value.split(',').map(s => s.trim()).filter(Boolean);
  }

  function formatSelectors(selectors?: string[]): string {
    return selectors?.join(', ') || '';
  }
</script>

<div class="options-form">
  <label>
    Wait For
    <select
      value={options.waitFor ?? ''}
      onchange={(e) => {
        const val = e.currentTarget.value;
        options.waitFor = val ? val as 'load' | 'networkidle' | 'domcontentloaded' : undefined;
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
      value={options.waitForSelector ?? ''}
      onchange={(e) => { options.waitForSelector = e.currentTarget.value || undefined; }}
      placeholder="#element"
    />
  </label>
  <label>
    Wait Timeout (ms)
    <input
      type="number"
      value={options.waitForTimeout ?? ''}
      onchange={(e) => { options.waitForTimeout = parseInt(e.currentTarget.value) || undefined; }}
    />
  </label>
  <label>
    Selector (capture element)
    <input
      type="text"
      value={options.selector ?? ''}
      onchange={(e) => { options.selector = e.currentTarget.value || undefined; }}
      placeholder=".main-content"
    />
  </label>
  <label class="checkbox">
    <input
      type="checkbox"
      checked={options.fullPage ?? false}
      onchange={(e) => { options.fullPage = e.currentTarget.checked || undefined; }}
    />
    Full Page Screenshot
  </label>
  <label>
    Hide Selectors
    <input
      type="text"
      value={formatSelectors(options.hideSelectors)}
      onchange={(e) => {
        const selectors = parseSelectors(e.currentTarget.value);
        options.hideSelectors = selectors.length ? selectors : undefined;
      }}
      placeholder=".ad, .cookie-banner"
    />
    <span class="hint-inline">Comma-separated (visibility: hidden)</span>
  </label>
  <label>
    Remove Selectors
    <input
      type="text"
      value={formatSelectors(options.removeSelectors)}
      onchange={(e) => {
        const selectors = parseSelectors(e.currentTarget.value);
        options.removeSelectors = selectors.length ? selectors : undefined;
      }}
      placeholder=".modal, .popup"
    />
    <span class="hint-inline">Comma-separated (display: none)</span>
  </label>

  {#if showDiffThreshold}
    <label>
      Max Diff % (override)
      <input
        type="number"
        min="0"
        step="0.01"
        value={options.diffThreshold?.maxDiffPercentage ?? ''}
        onchange={(e) => {
          const value = parseFloat(e.currentTarget.value);
          if (!options.diffThreshold) options.diffThreshold = {};
          if (Number.isNaN(value)) {
            delete options.diffThreshold.maxDiffPercentage;
          } else {
            options.diffThreshold.maxDiffPercentage = value;
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
        value={options.diffThreshold?.maxDiffPixels ?? ''}
        onchange={(e) => {
          const value = parseInt(e.currentTarget.value);
          if (!options.diffThreshold) options.diffThreshold = {};
          if (Number.isNaN(value)) {
            delete options.diffThreshold.maxDiffPixels;
          } else {
            options.diffThreshold.maxDiffPixels = value;
          }
        }}
      />
    </label>
  {/if}

  <label class="full-width">
    Before Screenshot (JS)
    <textarea
      value={options.beforeScreenshot ?? ''}
      onchange={(e) => { options.beforeScreenshot = e.currentTarget.value || undefined; }}
      rows="3"
      placeholder="await page.click('.close-modal');"
    ></textarea>
  </label>
</div>

<style>
  .options-form {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 1rem;
  }

  label {
    display: block;
    font-size: 0.8rem;
    color: var(--text-muted);
  }

  input[type="text"],
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

  .hint-inline {
    font-size: 0.7rem;
    color: var(--text-muted);
    display: block;
    margin-top: 0.25rem;
  }

  .full-width {
    grid-column: 1 / -1;
  }
</style>
