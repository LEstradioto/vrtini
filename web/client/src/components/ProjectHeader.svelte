<script lang="ts">
  interface TestState {
    jobId: string;
    progress: number;
    total: number;
    aborting?: boolean;
    phase?: string;
  }

  interface Props {
    title: string;
    path?: string;
    testState?: TestState;
    onRunTests: () => void;
    onAbortTests: () => void;
    onOpenConfig: () => void;
  }

  let {
    title,
    path,
    testState,
    onRunTests,
    onAbortTests,
    onOpenConfig,
  }: Props = $props();
</script>

<div class="project-header">
  <div class="header-left">
    <h1>{title}</h1>
    {#if path}
      <p class="path">{path}</p>
    {/if}
  </div>
  <div class="header-actions">
    {#if testState}
      <div class="progress-inline">
        <span class="progress-phase">{testState.phase}</span>
        <div class="progress-bar">
          <div
            class="progress-fill"
            style="width: {testState.total > 0 ? (testState.progress / testState.total) * 100 : 0}%"
          ></div>
          <span>{testState.progress}/{testState.total}</span>
        </div>
        <button class="btn small stop" onclick={onAbortTests} disabled={testState.aborting}>
          {testState.aborting ? '...' : 'Stop'}
        </button>
      </div>
    {:else}
      <button class="btn primary" onclick={onRunTests}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polygon points="5 3 19 12 5 21 5 3" />
        </svg>
        Run Tests
      </button>
    {/if}
    <button class="btn" onclick={onOpenConfig}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="12" r="3" />
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82V9a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
      </svg>
      Config
    </button>
  </div>
</div>

<style>
  .project-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    margin-bottom: 20px;
  }

  .header-left h1 {
    margin: 0;
    font-size: 24px;
  }

  .path {
    font-size: 13px;
    color: var(--text-muted);
    margin-top: 4px;
  }

  .header-actions {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .progress-inline {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 10px;
    border-radius: 8px;
    background: var(--panel-strong);
    border: 1px solid var(--border);
  }

  .progress-phase {
    font-size: 12px;
    color: var(--text-muted);
    text-transform: uppercase;
  }

  .progress-bar {
    position: relative;
    width: 140px;
    height: 8px;
    background: var(--border);
    border-radius: 6px;
    overflow: hidden;
  }

  .progress-bar span {
    position: absolute;
    right: 6px;
    top: -18px;
    font-size: 11px;
    color: var(--text-muted);
  }

  .progress-fill {
    height: 100%;
    background: var(--accent);
  }

  .btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 8px 14px;
    border-radius: 8px;
    border: 1px solid var(--border);
    background: var(--panel-strong);
    color: var(--text);
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.15s ease, border-color 0.15s ease;
  }

  .btn:hover {
    background: var(--panel);
    border-color: var(--border-soft);
  }

  .btn.primary {
    background: #2563eb;
    border-color: #2563eb;
    color: #fff;
  }

  .btn.primary:hover {
    background: #1d4ed8;
    border-color: #1d4ed8;
  }

  .btn.small {
    padding: 6px 10px;
    font-size: 12px;
  }

  .btn.stop {
    background: #ef4444;
    border-color: #ef4444;
  }

  .btn.stop:hover {
    background: #dc2626;
    border-color: #dc2626;
  }

  .btn.stop:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
</style>
