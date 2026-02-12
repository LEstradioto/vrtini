<script lang="ts">
  import type { Scenario } from '../lib/api';
  import ScenarioOptionsForm from './ScenarioOptionsForm.svelte';

  let { scenarios = $bindable() } = $props<{ scenarios: Scenario[] }>();

  let expandedScenario = $state<number | null>(null);

  function addScenario() {
    scenarios = [
      ...scenarios,
      { name: 'new-scenario', url: 'https://example.com' },
    ];
    expandedScenario = scenarios.length - 1;
  }

  function removeScenario(index: number) {
    scenarios = scenarios.filter((_, i) => i !== index);
    if (expandedScenario === index) expandedScenario = null;
  }
</script>

<section class="section">
  <h2>
    Scenarios
    <button class="btn small" onclick={addScenario}>+ Add</button>
  </h2>
  <div class="scenario-list">
    {#each scenarios as scenario, i}
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
