<script lang="ts">
  import { projects, info, images, type Project } from '../lib/api';
  import { getErrorMessage } from '../lib/errors';
  import { getAppContext } from '../lib/app-context';

  const { navigate, runningTests, startTest, abortTest, testErrors, clearTestError } = getAppContext();

  let projectList = $state<Project[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);
  let showModal = $state(false);
  let newProject = $state({ name: '', path: '', configFile: 'vrt.config.json' });
  let serverInfo = $state<{ cwd: string; projectName: string; hasConfig: boolean; existingConfig: string | null } | null>(null);

  // Image data for each project (arrays for per-image status calculation)
  let imageData = $state<Map<string, { baselines: string[]; tests: string[]; diffs: string[] }>>(new Map());

  async function loadProjects() {
    try {
      loading = true;
      const [projectsRes, infoRes] = await Promise.all([
        projects.list(),
        info.get(),
      ]);
      projectList = projectsRes.projects;
      serverInfo = infoRes;

      // Load image counts for all projects
      await loadAllImageCounts(projectsRes.projects);
    } catch (err) {
      error = getErrorMessage(err, 'Failed to load projects');
    } finally {
      loading = false;
    }
  }

  async function loadAllImageCounts(projectsList: Project[]) {
    const data = new Map<string, { baselines: string[]; tests: string[]; diffs: string[] }>();
    await Promise.all(
      projectsList.map(async (p) => {
        try {
          const res = await images.list(p.id);
          data.set(p.id, {
            baselines: res.baselines,
            tests: res.tests,
            diffs: res.diffs,
          });
        } catch {
          // Ignore errors for individual projects
        }
      })
    );
    imageData = data;
  }

  function openAddModal() {
    // Pre-fill with server's cwd
    if (serverInfo) {
      newProject = {
        name: serverInfo.projectName,
        path: serverInfo.cwd,
        configFile: serverInfo.existingConfig || 'vrt.config.json',
      };
    }
    showModal = true;
  }

  async function importCurrentProject() {
    if (!serverInfo?.hasConfig) return;

    try {
      const existing = projectList.find((p) => p.path === serverInfo!.cwd);
      if (existing) {
        navigate(`/project/${existing.id}`);
        return;
      }

      await projects.create({
        name: serverInfo.projectName,
        path: serverInfo.cwd,
        configFile: serverInfo.existingConfig || undefined,
      });
      await loadProjects();
    } catch (err) {
      error = getErrorMessage(err, 'Failed to import project');
    }
  }

  async function createProject() {
    if (!newProject.name || !newProject.path) return;

    try {
      await projects.create({
        name: newProject.name,
        path: newProject.path,
        configFile: newProject.configFile,
      });
      newProject = { name: '', path: '', configFile: 'vrt.config.json' };
      showModal = false;
      await loadProjects();
    } catch (err) {
      error = getErrorMessage(err, 'Failed to create project');
    }
  }

  async function runTests(project: Project, e: Event) {
    e.stopPropagation();

    try {
      await startTest(project, () => loadProjects());
    } catch (err) {
      error = getErrorMessage(err, 'Failed to run tests');
    }
  }

  async function abortTests(project: Project, e: Event) {
    e.stopPropagation();

    try {
      await abortTest(project.id);
      await loadProjects();
    } catch (err) {
      error = getErrorMessage(err, 'Failed to abort tests');
    }
  }

  // Load on mount
  $effect(() => {
    loadProjects();
  });

  function getStatusColor(status?: string) {
    switch (status) {
      case 'passed': return '#22c55e';
      case 'failed': return '#ef4444';
      case 'new': return '#f59e0b';
      default: return '#666';
    }
  }

  function formatDuration(ms?: number): string {
    if (!ms) return '-';
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  }

  // Calculate status from image data (per-image logic)
  function getComputedStatus(data: { baselines: string[]; tests: string[]; diffs: string[] } | undefined): string {
    if (!data) return 'not run';
    if (data.diffs.length > 0) return 'failed';
    // Check if any test lacks a baseline
    const hasNew = data.tests.some(t => !data.baselines.includes(t));
    if (hasNew) return 'new';
    if (data.tests.length === 0) return 'not run';
    return 'passed';
  }
</script>

<div class="dashboard">
  <div class="header">
    <h1>Projects</h1>
    <div class="header-actions">
      {#if serverInfo?.hasConfig}
        <button class="btn" onclick={importCurrentProject}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
          Import Current
        </button>
      {/if}
      <button class="btn primary" onclick={openAddModal}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
        Add Project
      </button>
    </div>
  </div>

  {#if error}
    <div class="error">{error}</div>
  {/if}

  {#if testErrors.size > 0}
    {#each [...testErrors.entries()] as [projectId, testError]}
      {@const project = projectList.find(p => p.id === projectId)}
      <div class="error test-error">
        <div class="error-header">
          <strong>Test failed{project ? ` for ${project.name}` : ''}</strong>
          <button class="error-close" onclick={() => clearTestError(projectId)}>&times;</button>
        </div>
        <div class="error-message">{testError}</div>
      </div>
    {/each}
  {/if}

  {#if loading}
    <div class="loading">Loading projects...</div>
  {:else if projectList.length === 0}
    <div class="empty">
      <p>No projects yet. Add a project to get started.</p>
    </div>
  {:else}
    <div class="grid">
      {#each projectList as project}
        {@const computedStatus = getComputedStatus(imageData.get(project.id))}
        <div
          class="card"
          onclick={() => navigate(`/project/${project.id}`)}
          onkeydown={(e) => e.key === 'Enter' && navigate(`/project/${project.id}`)}
          role="button"
          tabindex="0"
        >
          <div class="card-header">
            <h3>{project.name}</h3>
            <span class="status" style="background: {getStatusColor(computedStatus)}">
              {computedStatus}
            </span>
          </div>

          <p class="path">{project.path}</p>

          <!-- Image counts -->
          {#if imageData.get(project.id)}
            {@const data = imageData.get(project.id)!}
            <div class="stats">
              <span class="stat" title="Baselines">
                <span class="stat-icon">B</span>
                {data.baselines.length}
              </span>
              <span class="stat" title="Tests">
                <span class="stat-icon">T</span>
                {data.tests.length}
              </span>
              {#if data.diffs.length > 0}
                <span class="stat diff" title="Diffs (changes detected)">
                  <span class="stat-icon">D</span>
                  {data.diffs.length}
                </span>
              {/if}
            </div>
          {/if}

          {#if project.lastRun}
            <p class="meta">Last run: {new Date(project.lastRun).toLocaleString()}</p>
            {#if project.lastTiming}
              <div class="timing-stats">
                <span class="timing" title="Screenshot capture time">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                    <circle cx="9" cy="9" r="2"></circle>
                    <path d="M21 15l-3.086-3.086a2 2 0 0 0-2.828 0L6 21"></path>
                  </svg>
                  {formatDuration(project.lastTiming.screenshotDuration)}
                </span>
                <span class="timing" title="Comparison time">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5"></path>
                  </svg>
                  {formatDuration(project.lastTiming.compareDuration)}
                </span>
                <span class="timing total" title="Total time">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="12" cy="12" r="10"></circle>
                    <polyline points="12 6 12 12 16 14"></polyline>
                  </svg>
                  {formatDuration(project.lastTiming.totalDuration)}
                </span>
              </div>
            {/if}
          {/if}

          <div class="actions">
            {#if runningTests.has(project.id)}
              {@const testState = runningTests.get(project.id)}
              <div class="progress-section">
                <div class="progress-phase">{testState!.phase}</div>
                <div class="progress-container">
                  <div class="progress-bar">
                    <div
                      class="progress-fill"
                      style="width: {testState!.total > 0 ? (testState!.progress / testState!.total) * 100 : 0}%"
                    ></div>
                    <span>{testState!.progress}/{testState!.total}</span>
                  </div>
                  <button
                    class="btn small stop"
                    onclick={(e) => abortTests(project, e)}
                    disabled={testState!.aborting}
                  >
                    {testState!.aborting ? '...' : 'Stop'}
                  </button>
                </div>
              </div>
            {:else}
              <button class="btn small primary" onclick={(e) => runTests(project, e)}>
                Run Tests
              </button>
              <button class="btn small" onclick={(e) => { e.stopPropagation(); navigate(`/project/${project.id}`); }}>
                View
              </button>
            {/if}
          </div>
        </div>
      {/each}
    </div>
  {/if}
</div>

{#if showModal}
  <div class="modal-overlay" onclick={() => (showModal = false)} onkeydown={(e) => e.key === 'Escape' && (showModal = false)} role="dialog" aria-modal="true">
    <div class="modal" onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.stopPropagation()} role="document">
      <h2>Add Project</h2>

      <label>
        Project Name
        <input type="text" bind:value={newProject.name} placeholder="My App" />
      </label>

      <label>
        Project Path
        <input type="text" bind:value={newProject.path} placeholder="/path/to/project" />
      </label>

      <label>
        Config File
        <input type="text" bind:value={newProject.configFile} placeholder="vrt.config.json" />
      </label>

      <div class="modal-actions">
        <button class="btn" onclick={() => (showModal = false)}>Cancel</button>
        <button class="btn primary" onclick={createProject}>Create</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .dashboard {
    max-width: 1200px;
    margin: 0 auto;
  }

  .header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 1.5rem;
  }

  .header-actions {
    display: flex;
    gap: 0.5rem;
  }

  h1 {
    font-size: 1.5rem;
    font-weight: 600;
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
    padding: 0.375rem 0.75rem;
    font-size: 0.8rem;
  }

  .error {
    background: rgba(239, 68, 68, 0.12);
    border: 1px solid rgba(239, 68, 68, 0.5);
    padding: 0.75rem 1rem;
    border-radius: 6px;
    margin-bottom: 1rem;
  }

  .test-error {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .error-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .error-close {
    background: none;
    border: none;
    color: #ef4444;
    font-size: 1.5rem;
    cursor: pointer;
    padding: 0;
    line-height: 1;
  }

  .error-close:hover {
    color: var(--text-strong);
  }

  .error-message {
    font-family: monospace;
    font-size: 0.85rem;
    white-space: pre-wrap;
    color: #fca5a5;
  }

  .loading, .empty {
    text-align: center;
    padding: 3rem;
    color: var(--text-muted);
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
    gap: 1rem;
  }

  .card {
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 1rem;
    cursor: pointer;
    transition: border-color 0.2s, transform 0.2s;
  }

  .card:hover {
    border-color: var(--accent);
    transform: translateY(-2px);
  }

  .card-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 0.5rem;
  }

  .card h3 {
    font-size: 1.1rem;
    font-weight: 500;
  }

  .status {
    font-size: 0.7rem;
    padding: 0.25rem 0.5rem;
    border-radius: 4px;
    text-transform: uppercase;
    font-weight: 600;
    color: var(--text-strong);
  }

  .path {
    font-size: 0.8rem;
    color: var(--text-muted);
    font-family: monospace;
    margin-bottom: 0.5rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .stats {
    display: flex;
    gap: 0.75rem;
    align-items: center;
    margin-bottom: 0.5rem;
    flex-wrap: wrap;
  }

  .stat {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    font-size: 0.75rem;
    color: var(--text-muted);
  }

  .stat-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    background: var(--border);
    border-radius: 3px;
    font-size: 0.65rem;
    font-weight: 600;
    color: var(--text-muted);
  }

  .stat.diff {
    color: #ef4444;
  }

  .stat.diff .stat-icon {
    background: #7f1d1d;
    color: #ef4444;
  }

  .meta {
    font-size: 0.75rem;
    color: var(--text-muted);
    margin-bottom: 0.5rem;
  }

  .timing-stats {
    display: flex;
    gap: 0.75rem;
    margin-bottom: 0.75rem;
  }

  .timing {
    display: flex;
    align-items: center;
    gap: 0.25rem;
    font-size: 0.7rem;
    color: var(--text-muted);
  }

  .timing svg {
    opacity: 0.6;
  }

  .timing.total {
    color: var(--accent);
  }

  .timing.total svg {
    opacity: 1;
  }

  .actions {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
  }

  .progress-section {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .progress-phase {
    font-size: 0.7rem;
    color: var(--accent);
    font-weight: 500;
  }

  .progress-container {
    display: flex;
    gap: 0.5rem;
    align-items: center;
  }

  .progress-bar {
    flex: 1;
    height: 28px;
    background: var(--border);
    border-radius: 4px;
    overflow: hidden;
    position: relative;
  }

  .progress-fill {
    height: 100%;
    background: var(--accent);
    transition: width 0.3s;
  }

  .progress-bar span {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    font-size: 0.75rem;
    font-weight: 500;
  }

  .btn.stop {
    background: #ef4444;
    flex-shrink: 0;
  }

  .btn.stop:hover {
    background: #dc2626;
  }

  .btn.stop:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .modal-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.7);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 200;
  }

  .modal {
    background: var(--panel);
    border: 1px solid var(--border);
    border-radius: 12px;
    padding: 1.5rem;
    width: 100%;
    max-width: 400px;
  }

  .modal h2 {
    font-size: 1.25rem;
    margin-bottom: 1rem;
  }

  .modal label {
    display: block;
    margin-bottom: 1rem;
    font-size: 0.875rem;
    color: var(--text-muted);
  }

  .modal input {
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

  .modal input:focus {
    outline: none;
    border-color: var(--accent);
  }

  .modal-actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
    margin-top: 1.5rem;
  }
</style>
