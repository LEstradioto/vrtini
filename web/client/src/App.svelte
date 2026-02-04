<script lang="ts">
  import Dashboard from './pages/Dashboard.svelte';
  import ProjectPage from './pages/Project.svelte';
  import Config from './pages/Config.svelte';
  import { test, type Project } from './lib/api';

  // Simple hash-based routing
  let route = $state(window.location.hash.slice(1) || '/');

  function navigate(path: string) {
    window.location.hash = path;
    route = path;
  }

  window.addEventListener('hashchange', () => {
    route = window.location.hash.slice(1) || '/';
  });

  // Parse route
  let page = $derived.by(() => {
    if (route.startsWith('/project/')) return 'project';
    if (route.startsWith('/config/')) return 'config';
    return 'dashboard';
  });

  let projectId = $derived.by(() => {
    const match = route.match(/^\/(project|config)\/([^/?]+)/);
    return match ? match[2] : null;
  });

  let projectTab = $derived.by(() => {
    const match = route.match(/\/project\/[^/?]+\?tab=(baselines|tests|diffs|compare|cross)/);
    return match ? match[1] as 'baselines' | 'tests' | 'diffs' | 'compare' | 'cross' : undefined;
  });

  // Theme state
  const THEME_KEY = 'vrt-theme';
  const initialTheme = (() => {
    try {
      const saved = localStorage.getItem(THEME_KEY);
      return saved === 'light' ? 'light' : 'dark';
    } catch {
      return 'dark';
    }
  })();
  let theme = $state<'dark' | 'light'>(initialTheme);

  $effect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      // ignore storage errors
    }
  });

  // Global running tests state - persists across navigation
  interface TestState {
    jobId: string;
    progress: number;
    total: number;
    aborting?: boolean;
    phase?: string;
    error?: string;
  }
  let runningTests = $state<Map<string, TestState>>(new Map());
  let pollIntervals = new Map<string, number>();

  // Global test errors - shown after tests complete with failure
  let testErrors = $state<Map<string, string>>(new Map());

  // Start a test run for a project
  async function startTest(project: Project, onComplete?: () => void) {
    try {
      const res = await test.run(project.id);
      runningTests.set(project.id, {
        jobId: res.jobId,
        progress: 0,
        total: res.total,
        phase: 'Starting...'
      });
      runningTests = new Map(runningTests);

      // Start polling
      startPolling(project.id, res.jobId, onComplete);
    } catch (err) {
      console.error('Failed to start test:', err);
      throw err;
    }
  }

  function startPolling(projectId: string, jobId: string, onComplete?: () => void) {
    // Clear any existing poll for this project
    const existingPoll = pollIntervals.get(projectId);
    if (existingPoll) {
      clearInterval(existingPoll);
    }

    const poll = setInterval(async () => {
      const testState = runningTests.get(projectId);
      if (!testState) {
        clearInterval(poll);
        pollIntervals.delete(projectId);
        return;
      }

      try {
        const status = await test.status(projectId, jobId);

        // Use phase from server
        let phaseText = 'Starting...';
        if (status.phase === 'capturing') {
          phaseText = `Capturing ${status.progress}/${status.total}...`;
        } else if (status.phase === 'comparing') {
          phaseText = `Comparing ${status.progress}/${status.total}...`;
        } else if (status.phase === 'done') {
          phaseText = 'Finishing...';
        }

        runningTests.set(projectId, {
          ...testState,
          progress: status.progress,
          total: status.total,
          phase: phaseText
        });
        runningTests = new Map(runningTests);

        if (status.status !== 'running') {
          clearInterval(poll);
          pollIntervals.delete(projectId);
          runningTests.delete(projectId);
          runningTests = new Map(runningTests);

          // Capture error if test failed
          if (status.status === 'failed' && status.error) {
            testErrors.set(projectId, status.error);
            testErrors = new Map(testErrors);
          }

          onComplete?.();
        }
      } catch {
        // Status check failed, keep polling
      }
    }, 500);

    pollIntervals.set(projectId, poll as unknown as number);
  }

  async function abortTest(projectId: string) {
    const testState = runningTests.get(projectId);
    if (!testState) return;

    // Mark as aborting
    runningTests.set(projectId, { ...testState, aborting: true });
    runningTests = new Map(runningTests);

    try {
      await test.abort(projectId, testState.jobId);
    } finally {
      // Clear polling and state
      const poll = pollIntervals.get(projectId);
      if (poll) {
        clearInterval(poll);
        pollIntervals.delete(projectId);
      }
      runningTests.delete(projectId);
      runningTests = new Map(runningTests);
    }
  }

  // Rerun specific images (single or bulk)
  async function rerunImage(project: Project, filenames: string | string[], onComplete?: () => void) {
    try {
      const res = await test.rerun(project.id, filenames);
      runningTests.set(project.id, {
        jobId: res.jobId,
        progress: 0,
        total: res.total,
        phase: 'Starting...'
      });
      runningTests = new Map(runningTests);

      startPolling(project.id, res.jobId, onComplete);
    } catch (err) {
      console.error('Failed to rerun:', err);
      throw err;
    }
  }

  function clearTestError(projectId: string) {
    testErrors.delete(projectId);
    testErrors = new Map(testErrors);
  }
</script>

<div class="app">
  <header>
    <nav>
      <a href="#/" class="logo" onclick={() => navigate('/')}>
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="3" y="3" width="7" height="7" />
          <rect x="14" y="3" width="7" height="7" />
          <rect x="3" y="14" width="7" height="7" />
          <rect x="14" y="14" width="7" height="7" />
        </svg>
        vrtini
      </a>
      {#if projectId}
        <span class="breadcrumb">/</span>
        <a href="#/" onclick={() => navigate('/')}>Projects</a>
        <span class="breadcrumb">/</span>
        <span class="current">{projectId}</span>
      {/if}
      <div class="nav-actions">
        <button
          class="btn ghost"
          onclick={() => theme = theme === 'dark' ? 'light' : 'dark'}
          title="Toggle theme"
        >
          {#if theme === 'dark'}
            Light
          {:else}
            Dark
          {/if}
        </button>
      </div>
    </nav>
  </header>

  <main>
    {#if page === 'dashboard'}
      <Dashboard {navigate} {runningTests} {startTest} {abortTest} {testErrors} {clearTestError} />
    {:else if page === 'project' && projectId}
      <ProjectPage {projectId} {navigate} {runningTests} {startTest} {abortTest} {rerunImage} {testErrors} {clearTestError} initialTab={projectTab} />
    {:else if page === 'config' && projectId}
      <Config {projectId} {navigate} />
    {/if}
  </main>
</div>

<style>
  :global(:root) {
    color-scheme: dark;
    --bg: #0f0f0f;
    --panel: #1a1a1a;
    --panel-strong: #111;
    --panel-soft: #151515;
    --border: #333;
    --border-soft: #2b2b2b;
    --text: #e0e0e0;
    --text-strong: #ffffff;
    --text-muted: #888;
    --accent: #6366f1;
    --accent-strong: #4f46e5;
  }

  :global([data-theme='light']) {
    color-scheme: light;
    --bg: #f6f7fb;
    --panel: #ffffff;
    --panel-strong: #f0f2f7;
    --panel-soft: #ffffff;
    --border: #e1e5ee;
    --border-soft: #d6dbea;
    --text: #111827;
    --text-strong: #0b1220;
    --text-muted: #5f6b85;
    --accent: #2563eb;
    --accent-strong: #1d4ed8;
  }

  :global(*) {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
  }

  :global(body) {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background: var(--bg);
    color: var(--text);
    min-height: 100vh;
  }

  .app {
    min-height: 100vh;
    display: flex;
    flex-direction: column;
  }

  header {
    background: var(--panel);
    border-bottom: 1px solid var(--border);
    padding: 0.75rem 1.5rem;
    position: sticky;
    top: 0;
    z-index: 100;
  }

  nav {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .logo {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-weight: 600;
    font-size: 1.1rem;
    color: var(--text-strong);
    text-decoration: none;
  }

  .logo svg {
    color: var(--accent);
  }

  nav a {
    color: var(--text-muted);
    text-decoration: none;
    transition: color 0.2s;
  }

  nav a:hover {
    color: var(--text-strong);
  }

  .breadcrumb {
    color: var(--border);
  }

  .current {
    color: var(--accent);
    font-weight: 500;
  }

  .nav-actions {
    margin-left: auto;
  }

  .btn.ghost {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 6px 12px;
    border-radius: 999px;
    border: 1px solid var(--border);
    background: transparent;
    color: var(--text);
    font-size: 12px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    cursor: pointer;
  }

  .btn.ghost:hover {
    border-color: var(--accent);
    color: var(--text-strong);
  }

  main {
    flex: 1;
    padding: 1.5rem;
    max-width: 1400px;
    margin: 0 auto;
    width: 100%;
  }
</style>
