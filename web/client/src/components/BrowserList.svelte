<script lang="ts">
  import type { BrowserConfig } from '../lib/api';

  let { browsers = $bindable() } = $props<{ browsers: BrowserConfig[] }>();

  interface BrowserEntry {
    name: 'chromium' | 'webkit';
    version: string;
    index: number;
  }

  let browserEntries = $derived.by((): BrowserEntry[] => {
    return browsers.map((b, index) => {
      if (typeof b === 'string') {
        return { name: b, version: '', index };
      }
      return { name: b.name, version: b.version || '', index };
    });
  });

  function addBrowser(name: 'chromium' | 'webkit') {
    browsers = [...browsers, name];
  }

  function removeBrowser(index: number) {
    browsers = browsers.filter((_, i) => i !== index);
  }

  function updateBrowserVersion(index: number, version: string) {
    const entry = browsers[index];
    const name = typeof entry === 'string' ? entry : entry.name;
    if (version.trim()) {
      browsers[index] = { name, version: version.trim() };
    } else {
      browsers[index] = name;
    }
    browsers = [...browsers];
  }
</script>

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

  .btn.small {
    padding: 0.25rem 0.5rem;
    font-size: 0.75rem;
  }

  .btn.danger:hover {
    background: #ef4444;
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
    display: block;
    padding: 0.5rem;
    background: var(--panel-strong);
    border: 1px solid var(--border);
    border-radius: 6px;
    color: var(--text);
    font-size: 0.875rem;
  }

  .version-input:focus {
    outline: none;
    border-color: var(--accent);
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

  .hint {
    font-size: 0.75rem;
    color: var(--text-muted);
    margin-top: 0.5rem;
  }
</style>
