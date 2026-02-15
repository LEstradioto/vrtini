<script lang="ts">
  import type { Scenario } from '../lib/api';
  import ScenarioOptionsForm from './ScenarioOptionsForm.svelte';

  let { scenarios = $bindable() } = $props<{ scenarios: Scenario[] }>();

  let expandedScenarios = $state<Set<number>>(new Set());

  function isExpanded(index: number): boolean {
    return expandedScenarios.has(index);
  }

  function toggleScenario(index: number): void {
    const next = new Set(expandedScenarios);
    if (next.has(index)) {
      next.delete(index);
    } else {
      next.add(index);
    }
    expandedScenarios = next;
  }

  function expandAllScenarios(): void {
    expandedScenarios = new Set(scenarios.map((_, i) => i));
  }

  function collapseAllScenarios(): void {
    expandedScenarios = new Set();
  }

  function addScenario() {
    scenarios = [
      ...scenarios,
      { name: 'new-scenario', url: 'https://example.com' },
    ];
    expandedScenarios = new Set([...expandedScenarios, scenarios.length - 1]);
  }

  function removeScenario(index: number) {
    scenarios = scenarios.filter((_, i) => i !== index);
    const next = new Set<number>();
    for (const expandedIndex of expandedScenarios) {
      if (expandedIndex < index) next.add(expandedIndex);
      if (expandedIndex > index) next.add(expandedIndex - 1);
    }
    expandedScenarios = next;
  }
</script>

<section class="section">
  <h2>
    <span>Scenarios</span>
    <div class="scenario-actions">
      <button class="btn small" onclick={addScenario}>+ Add</button>
      <button class="btn small" onclick={expandAllScenarios} disabled={scenarios.length === 0}>
        Expand all
      </button>
      <button class="btn small" onclick={collapseAllScenarios} disabled={expandedScenarios.size === 0}>
        Collapse all
      </button>
    </div>
  </h2>
  <div class="scenario-list">
    {#each scenarios as scenario, i}
      <div class="scenario-item" class:expanded={isExpanded(i)}>
        <div
          class="scenario-header"
          onclick={() => toggleScenario(i)}
          onkeydown={(e) => e.key === 'Enter' && toggleScenario(i)}
          role="button"
          tabindex="0"
        >
          <span class="scenario-chevron" aria-hidden="true">{isExpanded(i) ? '▾' : '▸'}</span>
          <span class="scenario-name">{scenario.name}</span>
          <span class="scenario-url">{scenario.url}</span>
          <button
            class="btn small danger"
            onclick={(e) => { e.stopPropagation(); removeScenario(i); }}
          >
            x
          </button>
        </div>

        {#if isExpanded(i)}
          <div class="scenario-details">
            <label>
              Name
              <input type="text" bind:value={scenario.name} />
            </label>
            <label>
              URL
              <input type="text" bind:value={scenario.url} />
            </label>
            <ScenarioOptionsForm options={scenario} showDiffThreshold />
          </div>
        {/if}
      </div>
    {/each}
  </div>
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

  .scenario-actions {
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }

  .btn {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 1rem;
    border: none;
    border-radius: 0;
    background: var(--border);
    color: var(--text-strong);
    font-family: var(--font-mono, monospace);
    font-size: 0.875rem;
    cursor: pointer;
    transition: background 0.2s;
  }

  .btn:hover {
    background: var(--border-soft);
  }

  .btn:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  .btn.small {
    padding: 0.25rem 0.5rem;
    font-size: 0.75rem;
  }

  .btn.danger:hover {
    background: #ef4444;
  }

  .scenario-list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .scenario-item {
    background: var(--panel-strong);
    border: 1px solid var(--border);
    border-radius: 0;
    overflow: hidden;
  }

  .scenario-item.expanded {
    border-color: var(--accent);
  }

  .scenario-header {
    display: flex;
    align-items: center;
    gap: 0.65rem;
    padding: 0.75rem;
    cursor: pointer;
  }

  .scenario-header:hover {
    background: var(--panel);
  }

  .scenario-chevron {
    color: var(--text-muted);
    width: 0.7rem;
    font-size: 0.8rem;
    line-height: 1;
    flex-shrink: 0;
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

  .scenario-details :global(.options-form) {
    grid-column: 1 / -1;
  }

  label {
    display: block;
    font-family: var(--font-mono, monospace);
    font-size: 0.8rem;
    color: var(--text-muted);
  }

  input[type="text"] {
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

  input:focus {
    outline: none;
    border-color: var(--accent);
  }
</style>
