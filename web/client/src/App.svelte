<script lang="ts">
  import Dashboard from './pages/Dashboard.svelte';
  import ProjectPage from './pages/Project.svelte';
  import Config from './pages/Config.svelte';
  import { test, projects as projectsApi, type Project } from './lib/api';
  import { SvelteMap } from 'svelte/reactivity';
  import { setAppContext, type TestState } from './lib/app-context';
  import { getErrorMessage } from './lib/errors';
  import { log } from './lib/logger';
  import { POLL_INTERVAL_MS, MAX_POLL_FAILURES } from '../../shared/constants';

  // Simple hash-based routing
  let route = $state(window.location.hash.slice(1) || '/');

  function navigate(path: string) {
    window.location.hash = path;
    route = path;
  }

  $effect(() => {
    const onHashChange = () => {
      route = window.location.hash.slice(1) || '/';
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
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
    const match = route.match(/\/project\/[^/?]+\?tab=(baselines|tests|diffs|cross)/);
    return match ? match[1] as 'baselines' | 'tests' | 'diffs' | 'cross' : undefined;
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
  let runningTests = new SvelteMap<string, TestState>();
  let pollIntervals = new Map<string, ReturnType<typeof setInterval>>();
  let pollFailCounts = new Map<string, number>();

  // Clean up all poll intervals on unmount
  $effect(() => {
    return () => {
      for (const interval of pollIntervals.values()) {
        clearInterval(interval);
      }
      pollIntervals.clear();
      pollFailCounts.clear();
    };
  });

  // Global test errors - shown after tests complete with failure
  let testErrors = new SvelteMap<string, string>();

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

      // Start polling
      startPolling(project.id, res.jobId, onComplete);
    } catch (err) {
      log.error('Failed to start test:', getErrorMessage(err));
      throw err;
    }
  }

  function stopPolling(projectId: string) {
    const interval = pollIntervals.get(projectId);
    if (interval) {
      clearInterval(interval);
      pollIntervals.delete(projectId);
    }
    pollFailCounts.delete(projectId);
  }

  function startPolling(projectId: string, jobId: string, onComplete?: () => void) {
    // Clear any existing poll for this project
    stopPolling(projectId);

    const poll = setInterval(async () => {
      const testState = runningTests.get(projectId);
      if (!testState) {
        stopPolling(projectId);
        return;
      }

      try {
        const status = await test.status(projectId, jobId);
        pollFailCounts.set(projectId, 0);

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

        if (status.status !== 'running') {
          stopPolling(projectId);
          runningTests.delete(projectId);

          // Capture error if test failed
          if (status.status === 'failed' && status.error) {
            testErrors.set(projectId, status.error);
          }

          onComplete?.();
        }
      } catch {
        const fails = (pollFailCounts.get(projectId) ?? 0) + 1;
        pollFailCounts.set(projectId, fails);
        if (fails >= MAX_POLL_FAILURES) {
          stopPolling(projectId);
          runningTests.delete(projectId);
          testErrors.set(projectId, 'Lost connection to test runner');
        }
      }
    }, POLL_INTERVAL_MS);

    pollIntervals.set(projectId, poll);
  }

  async function abortTest(projectId: string) {
    const testState = runningTests.get(projectId);
    if (!testState) return;

    // Mark as aborting
    runningTests.set(projectId, { ...testState, aborting: true });

    try {
      await test.abort(projectId, testState.jobId);
    } finally {
      stopPolling(projectId);
      runningTests.delete(projectId);
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

      startPolling(project.id, res.jobId, onComplete);
    } catch (err) {
      log.error('Failed to rerun:', getErrorMessage(err));
      throw err;
    }
  }

  function clearTestError(projectId: string) {
    testErrors.delete(projectId);
  }

  let sidebarCollapsed = $state(false);

  // Sidebar project list
  let sidebarProjects = $state<Project[]>([]);

  async function loadSidebarProjects() {
    try {
      const res = await projectsApi.list();
      sidebarProjects = res.projects;
    } catch {
      // silent - sidebar projects are best-effort
    }
  }

  $effect(() => {
    loadSidebarProjects();
  });

  // Reload sidebar projects when navigating or when tests finish
  $effect(() => {
    if (page === 'dashboard') loadSidebarProjects();
  });

  // Refresh sidebar when running tests map changes (test completes)
  let prevRunningCount = $state(0);
  $effect(() => {
    const count = runningTests.size;
    if (count < prevRunningCount) loadSidebarProjects();
    prevRunningCount = count;
  });

  setAppContext({ navigate, runningTests, startTest, abortTest, rerunImage, testErrors, clearTestError });
</script>

<div class="app" class:sidebar-collapsed={sidebarCollapsed}>
  <aside class="sidebar">
    <div class="sidebar-top">
      <a href="#/" class="logo" onclick={() => navigate('/')}>
        <span class="logo-prompt">&gt;</span>
        <span class="logo-text">vrtini</span>
      </a>
      <nav>
        <!-- Dashboard -->
        <a
          href="#/"
          class="nav-item"
          class:active={page === 'dashboard'}
          onclick={(e) => { e.preventDefault(); navigate('/'); }}
          title="dashboard"
        >
          <svg class="nav-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
          <span class="nav-label">dashboard</span>
        </a>

        <!-- Projects section -->
        <div class="nav-section">
          <span class="nav-section-label">
            <svg class="nav-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
            <span class="nav-label">projects ({sidebarProjects.length})</span>
          </span>
          <div class="nav-project-list">
            {#each sidebarProjects as proj}
              {@const isRunning = runningTests.has(proj.id)}
              {@const isActive = projectId === proj.id && (page === 'project' || page === 'config')}
              {@const statusClass = isRunning ? 'running' : proj.lastStatus === 'failed' ? 'failed' : proj.lastStatus === 'passed' ? 'passed' : ''}
              <a
                href="#/project/{proj.id}"
                class="nav-project"
                class:active={isActive}
                onclick={(e) => { e.preventDefault(); navigate(`/project/${proj.id}`); }}
                title="{proj.name}{isRunning ? ' (running)' : proj.lastStatus ? ` [${proj.lastStatus}]` : ''}"
              >
                <span class="nav-project-dot {statusClass}"></span>
                <span class="nav-label">{proj.name}</span>
              </a>
            {/each}
          </div>
        </div>

      </nav>
    </div>
    <div class="sidebar-bottom">
      <button
        class="theme-toggle"
        onclick={() => theme = theme === 'dark' ? 'light' : 'dark'}
        title={theme === 'dark' ? 'Switch to light' : 'Switch to dark'}
      >
        {#if theme === 'dark'}
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>
          <span class="nav-label">light</span>
        {:else}
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>
          <span class="nav-label">dark</span>
        {/if}
      </button>
    </div>
  </aside>

  <!-- Collapse toggle outside sidebar so it's always accessible -->
  <button
    class="collapse-toggle"
    onclick={() => sidebarCollapsed = !sidebarCollapsed}
    title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
  >
    {sidebarCollapsed ? '>' : '<'}
  </button>

  <main>
    {#if page === 'dashboard'}
      <Dashboard />
    {:else if page === 'project' && projectId}
      <ProjectPage {projectId} initialTab={projectTab} />
    {:else if page === 'config' && projectId}
      <Config {projectId} />
    {/if}
  </main>
</div>

<style>
  @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700&family=IBM+Plex+Mono:wght@400;500&display=swap');

  :global(:root) {
    color-scheme: dark;
    --bg: #0A0A0A;
    --panel: #0A0A0A;
    --panel-strong: #111;
    --panel-soft: #0e0e0e;
    --border: #2a2a2a;
    --border-soft: #222;
    --text: #e0e0e0;
    --text-strong: #FAFAFA;
    --text-muted: #6B7280;
    --accent: #10B981;
    --accent-strong: #059669;
    --accent-subtle: rgba(16, 185, 129, 0.1);
    --sidebar-w: 240px;
    --font-mono: 'JetBrains Mono', 'SF Mono', 'Fira Code', monospace;
    --font-body: 'IBM Plex Mono', 'SF Mono', monospace;
    --color-passed: #10B981;
    --color-failed: #EF4444;
    --color-new: #F59E0B;
    --color-info: #06B6D4;
  }

  :global([data-theme='light']) {
    color-scheme: light;
    --bg: #FAFAFA;
    --panel: #FFFFFF;
    --panel-strong: #F3F4F6;
    --panel-soft: #F9FAFB;
    --border: #E5E7EB;
    --border-soft: #D1D5DB;
    --text: #1F2937;
    --text-strong: #111827;
    --text-muted: #6B7280;
    --accent: #059669;
    --accent-strong: #047857;
    --accent-subtle: rgba(5, 150, 105, 0.08);
    --color-passed: #059669;
    --color-failed: #DC2626;
    --color-new: #D97706;
    --color-info: #0891B2;
  }

  :global(*) {
    margin: 0;
    padding: 0;
    box-sizing: border-box;
  }

  :global(body) {
    font-family: var(--font-body);
    background: var(--bg);
    color: var(--text);
    min-height: 100vh;
    font-size: 13px;
  }

  .app {
    min-height: 100vh;
    display: flex;
  }

  .sidebar {
    width: var(--sidebar-w);
    min-height: 100vh;
    position: fixed;
    top: 0;
    left: 0;
    display: flex;
    flex-direction: column;
    justify-content: space-between;
    padding: 32px 24px;
    background: var(--bg);
    border-right: 1px solid var(--border);
    z-index: 100;
    transition: width 0.2s, padding 0.2s;
  }

  .sidebar-collapsed .sidebar {
    width: 56px;
    padding: 32px 8px;
    overflow: hidden;
  }

  .sidebar-collapsed .logo-text,
  .sidebar-collapsed .nav-label,
  .sidebar-collapsed .nav-project-list,
  .sidebar-collapsed .nav-section-label .nav-label {
    display: none;
  }

  .sidebar-top {
    display: flex;
    flex-direction: column;
    gap: 32px;
  }

  .logo {
    display: flex;
    align-items: center;
    gap: 8px;
    text-decoration: none;
    white-space: nowrap;
  }

  .logo-prompt {
    font-family: var(--font-mono);
    font-weight: 700;
    font-size: 20px;
    color: var(--accent);
  }

  .logo-text {
    font-family: var(--font-mono);
    font-weight: 500;
    font-size: 18px;
    color: var(--text-strong);
  }

  nav {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .nav-item {
    display: flex;
    align-items: center;
    gap: 12px;
    height: 40px;
    padding: 0 12px;
    font-family: var(--font-mono);
    font-size: 13px;
    color: var(--text-muted);
    text-decoration: none;
    transition: color 0.15s, background 0.15s;
  }

  .nav-item:hover {
    color: var(--text-strong);
  }

  .nav-item.active {
    background: var(--accent-subtle);
    color: var(--text-strong);
  }

  .nav-icon {
    flex-shrink: 0;
    opacity: 0.6;
  }

  .nav-item:hover .nav-icon,
  .nav-item.active .nav-icon {
    opacity: 1;
  }

  .nav-label {
    white-space: nowrap;
    overflow: hidden;
  }

  .nav-section {
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin-top: 8px;
  }

  .nav-section-label {
    display: flex;
    align-items: center;
    gap: 12px;
    height: 32px;
    padding: 0 12px;
    font-family: var(--font-mono);
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--text-muted);
  }

  .nav-section-label .nav-icon {
    opacity: 0.5;
  }

  .nav-project-list {
    display: flex;
    flex-direction: column;
    gap: 1px;
    padding-left: 12px;
    max-height: 200px;
    overflow-y: auto;
  }

  .nav-project {
    display: flex;
    align-items: center;
    gap: 8px;
    height: 32px;
    padding: 0 12px;
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--text-muted);
    text-decoration: none;
    transition: color 0.15s;
  }

  .nav-project:hover {
    color: var(--text-strong);
  }

  .nav-project.active {
    color: var(--accent);
  }

  .nav-project-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--text-muted);
    flex-shrink: 0;
  }

  .nav-project.active .nav-project-dot {
    background: var(--accent);
  }

  .nav-project-dot.passed {
    background: var(--color-passed);
  }

  .nav-project-dot.failed {
    background: var(--color-failed);
  }

  .nav-project-dot.running {
    background: var(--color-new);
    animation: pulse 1.5s ease-in-out infinite;
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.3; }
  }

  .collapse-toggle {
    position: fixed;
    top: 40px;
    left: var(--sidebar-w);
    transform: translateX(-50%);
    width: 20px;
    height: 20px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 50%;
    color: var(--text-muted);
    font-family: var(--font-mono);
    font-size: 10px;
    cursor: pointer;
    z-index: 101;
    transition: left 0.2s, color 0.15s;
    padding: 0;
    line-height: 1;
  }

  .collapse-toggle:hover {
    color: var(--text-strong);
    border-color: var(--accent);
  }

  .sidebar-collapsed .collapse-toggle {
    left: 56px;
  }

  .sidebar-collapsed .nav-item {
    justify-content: center;
    padding: 0;
  }

  .sidebar-collapsed .nav-section-label {
    justify-content: center;
    padding: 0;
  }

  .sidebar-collapsed .theme-toggle {
    justify-content: center;
    padding: 8px 0;
  }

  .sidebar-bottom {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .theme-toggle {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    background: none;
    border: none;
    color: var(--text-muted);
    font-family: var(--font-mono);
    font-size: 12px;
    cursor: pointer;
    transition: color 0.15s;
  }

  .theme-toggle:hover {
    color: var(--text-strong);
  }

  .sidebar-toggle {
    padding: 8px 12px;
    background: none;
    border: none;
    color: var(--text-muted);
    font-family: var(--font-mono);
    font-size: 12px;
    cursor: pointer;
    text-align: left;
  }

  .sidebar-toggle:hover {
    color: var(--text-strong);
  }

  main {
    flex: 1;
    margin-left: var(--sidebar-w);
    padding: 40px;
    min-height: 100vh;
    transition: margin-left 0.2s;
  }

  .sidebar-collapsed main {
    margin-left: 56px;
  }
</style>
