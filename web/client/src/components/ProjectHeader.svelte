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
    <div class="title-line">
      <span class="prompt">&gt;</span>
      <h1>{title}</h1>
    </div>
    {#if path}
      <p class="path">// {path}</p>
    {/if}
  </div>
  <div class="header-actions">
    {#if testState}
      <div class="progress-inline">
        <span class="progress-phase">{testState.phase}</span>
        <div class="progress-track">
          <div
            class="progress-fill"
            style="width: {testState.total > 0 ? (testState.progress / testState.total) * 100 : 0}%"
          ></div>
        </div>
        <span class="progress-text">{testState.progress}/{testState.total}</span>
        <button class="btn stop" onclick={onAbortTests} disabled={testState.aborting}>
          {testState.aborting ? '...' : 'stop'}
        </button>
      </div>
    {:else}
      <button class="btn primary" onclick={onRunTests}>Run Tests</button>
    {/if}
    <button class="btn" onclick={onOpenConfig}>config</button>
  </div>
</div>

<style>
  .project-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 16px;
    margin-bottom: 24px;
  }

  .title-line {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .prompt {
    font-family: var(--font-mono);
    font-weight: 700;
    font-size: 24px;
    color: var(--accent);
  }

  .header-left h1 {
    margin: 0;
    font-family: var(--font-mono);
    font-size: 24px;
    font-weight: 700;
    color: var(--text-strong);
  }

  .path {
    font-family: var(--font-body);
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
  }

  .progress-phase {
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--text-muted);
  }

  .progress-track {
    width: 120px;
    height: 4px;
    background: var(--border);
    overflow: hidden;
  }

  .progress-fill {
    height: 100%;
    background: var(--accent);
    transition: width 0.3s;
  }

  .progress-text {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--text-muted);
  }

  .btn {
    display: inline-flex;
    align-items: center;
    height: 36px;
    padding: 0 16px;
    border: 1px solid var(--border);
    background: none;
    color: var(--text-muted);
    font-family: var(--font-mono);
    font-size: 12px;
    cursor: pointer;
    transition: border-color 0.15s, color 0.15s;
  }

  .btn:hover {
    border-color: var(--accent);
    color: var(--text-strong);
  }

  .btn.primary {
    background: var(--accent);
    border-color: var(--accent);
    color: var(--bg);
  }

  .btn.primary:hover {
    opacity: 0.85;
  }

  .btn.stop {
    border-color: var(--color-failed);
    color: var(--color-failed);
  }

  .btn.stop:hover {
    background: rgba(239, 68, 68, 0.1);
  }

  .btn.stop:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
</style>
