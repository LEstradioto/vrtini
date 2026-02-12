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

  function getStatusLabel(status?: string): string {
    switch (status) {
      case 'passed': return '[passed]';
      case 'failed': return '[failed]';
      case 'new': return '[new]';
      default: return '[--]';
    }
  }

  function getStatusClass(status?: string): string {
    switch (status) {
      case 'passed': return 'passed';
      case 'failed': return 'failed';
      case 'new': return 'new';
      default: return 'none';
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

  // Aggregate metrics
  let metrics = $derived.by(() => {
    let totalTests = 0;
    let totalPassed = 0;
    let totalDiffs = 0;

    for (const [, data] of imageData) {
      totalTests += data.tests.length;
      totalDiffs += data.diffs.length;
      const passed = data.tests.length - data.diffs.length;
      totalPassed += Math.max(0, passed);
    }

    const passRate = totalTests > 0 ? Math.round((totalPassed / totalTests) * 100) : 0;

    return {
      totalTests,
      passRate,
      totalDiffs,
      projectCount: projectList.length,
    };
  });
</script>

<div class="dashboard">
  <!-- Page Header -->
  <div class="page-header">
    <div class="header-left">
      <div class="title-line">
        <span class="prompt">&gt;</span>
        <h1>dashboard</h1>
      </div>
      <p class="subtitle">// visual regression testing overview</p>
    </div>
    <div class="header-actions">
      {#if serverInfo?.hasConfig}
        <button class="btn ghost" onclick={importCurrentProject}>$ vrt import</button>
      {/if}
      <button class="btn primary" onclick={openAddModal}>$ vrt add</button>
    </div>
  </div>

  {#if error}
    <div class="error-banner">{error}</div>
  {/if}

  {#if testErrors.size > 0}
    {#each [...testErrors.entries()] as [pid, testError]}
      {@const project = projectList.find(p => p.id === pid)}
      <div class="error-banner">
        <div class="error-header">
          <strong>test failed{project ? ` // ${project.name}` : ''}</strong>
          <button class="error-close" onclick={() => clearTestError(pid)}>&times;</button>
        </div>
        <pre class="error-message">{testError}</pre>
      </div>
    {/each}
  {/if}

  {#if loading}
    <div class="loading">loading projects...</div>
  {:else}
    <!-- Metrics Row -->
    <div class="metrics-section">
      <span class="section-label">// overview_stats</span>
      <div class="metrics-row">
        <div class="metric-card">
          <span class="metric-label">total_tests</span>
          <span class="metric-value">{metrics.totalTests}</span>
          <span class="metric-delta">
            <span class="delta-prefix">++</span>
            {metrics.totalTests > 0 ? `${metrics.projectCount} project${metrics.projectCount !== 1 ? 's' : ''}` : 'no tests yet'}
          </span>
        </div>
        <div class="metric-card">
          <span class="metric-label">pass_rate</span>
          <span class="metric-value">{metrics.passRate}%</span>
          <span class="metric-delta">
            <span class="delta-prefix">++</span>
            {metrics.passRate === 100 ? 'all passing' : `${metrics.totalDiffs} diff${metrics.totalDiffs !== 1 ? 's' : ''} found`}
          </span>
        </div>
        <div class="metric-card">
          <span class="metric-label">active_diffs</span>
          <span class="metric-value">{metrics.totalDiffs}</span>
          <span class="metric-delta">
            <span class="delta-prefix">{metrics.totalDiffs > 0 ? '--' : '++'}</span>
            {metrics.totalDiffs === 0 ? 'clean' : 'needs review'}
          </span>
        </div>
        <div class="metric-card">
          <span class="metric-label">projects</span>
          <span class="metric-value">{metrics.projectCount}</span>
          <span class="metric-delta">
            <span class="delta-prefix">++</span>
            registered
          </span>
        </div>
      </div>
    </div>

    <!-- Projects List -->
    <div class="projects-section">
      <div class="section-header">
        <span class="section-label">// recent_projects</span>
        <span class="section-action">$ vrt list</span>
      </div>

      {#if projectList.length === 0}
        <div class="empty">
          <p>no projects registered. run <code>$ vrt add</code> to get started.</p>
        </div>
      {:else}
        <div class="project-list">
          {#each projectList as project, i}
            {@const computedStatus = getComputedStatus(imageData.get(project.id))}
            {@const data = imageData.get(project.id)}
            <div
              class="project-item"
              class:last={i === projectList.length - 1}
              onclick={() => navigate(`/project/${project.id}`)}
              onkeydown={(e) => e.key === 'Enter' && navigate(`/project/${project.id}`)}
              role="button"
              tabindex="0"
            >
              {#if runningTests.has(project.id)}
                {@const testState = runningTests.get(project.id)}
                <div class="project-left">
                  <span class="project-dot running"></span>
                  <div class="project-info">
                    <span class="project-name">{project.name}/</span>
                    <span class="project-meta">{testState!.phase}</span>
                  </div>
                </div>
                <div class="project-right">
                  <div class="progress-inline">
                    <div class="progress-track">
                      <div
                        class="progress-fill"
                        style="width: {testState!.total > 0 ? (testState!.progress / testState!.total) * 100 : 0}%"
                      ></div>
                    </div>
                    <span class="progress-text">{testState!.progress}/{testState!.total}</span>
                    <button
                      class="btn-inline stop"
                      onclick={(e) => abortTests(project, e)}
                      disabled={testState!.aborting}
                    >
                      {testState!.aborting ? '...' : 'stop'}
                    </button>
                  </div>
                </div>
              {:else}
                <div class="project-left">
                  <span class="project-dot {getStatusClass(computedStatus)}"></span>
                  <div class="project-info">
                    <span class="project-name">{project.name}/</span>
                    <span class="project-meta">
                      {#if data}
                        {data.baselines.length} baselines
                        {#if data.diffs.length > 0}
                          &middot; {data.diffs.length} diff{data.diffs.length !== 1 ? 's' : ''}
                        {/if}
                      {:else}
                        {project.path}
                      {/if}
                      {#if project.lastTiming?.totalDuration}
                        &middot; {formatDuration(project.lastTiming.totalDuration)}
                      {/if}
                    </span>
                  </div>
                </div>
                <div class="project-right">
                  <button class="btn-inline" onclick={(e) => runTests(project, e)}>run</button>
                  <span class="status-badge {getStatusClass(computedStatus)}">{getStatusLabel(computedStatus)}</span>
                </div>
              {/if}
            </div>
          {/each}
        </div>
      {/if}
    </div>
  {/if}
</div>

{#if showModal}
  <div class="modal-overlay" onclick={() => (showModal = false)} onkeydown={(e) => e.key === 'Escape' && (showModal = false)} role="dialog" aria-modal="true">
    <div class="modal" onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.stopPropagation()} role="document">
      <h2>&gt; add_project</h2>

      <label>
        name
        <input type="text" bind:value={newProject.name} placeholder="my-app" />
      </label>

      <label>
        path
        <input type="text" bind:value={newProject.path} placeholder="/path/to/project" />
      </label>

      <label>
        config
        <input type="text" bind:value={newProject.configFile} placeholder="vrt.config.json" />
      </label>

      <div class="modal-actions">
        <button class="btn ghost" onclick={() => (showModal = false)}>cancel</button>
        <button class="btn primary" onclick={createProject}>create</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .dashboard {
    max-width: 1200px;
    margin: 0 auto;
  }

  /* Page Header */
  .page-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 40px;
  }

  .header-left {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .title-line {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .prompt {
    font-family: var(--font-mono);
    font-weight: 700;
    font-size: 28px;
    color: var(--accent);
  }

  h1 {
    font-family: var(--font-mono);
    font-weight: 700;
    font-size: 28px;
    color: var(--text-strong);
  }

  .subtitle {
    font-family: var(--font-body);
    font-size: 14px;
    color: var(--text-muted);
  }

  .header-actions {
    display: flex;
    gap: 12px;
    align-items: center;
  }

  /* Buttons */
  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    height: 40px;
    padding: 0 20px;
    border: none;
    font-family: var(--font-mono);
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    transition: opacity 0.15s;
    white-space: nowrap;
  }

  .btn:hover { opacity: 0.85; }

  .btn.primary {
    background: var(--accent);
    color: var(--bg);
  }

  .btn.ghost {
    background: none;
    border: 1px solid var(--border);
    color: var(--text-muted);
  }

  .btn.ghost:hover {
    border-color: var(--accent);
    color: var(--text-strong);
  }

  .btn-inline {
    background: none;
    border: 1px solid var(--border);
    color: var(--text-muted);
    font-family: var(--font-mono);
    font-size: 11px;
    padding: 4px 12px;
    cursor: pointer;
    transition: border-color 0.15s, color 0.15s;
  }

  .btn-inline:hover {
    border-color: var(--accent);
    color: var(--accent);
  }

  .btn-inline.stop {
    border-color: var(--color-failed);
    color: var(--color-failed);
  }

  /* Error */
  .error-banner {
    background: rgba(239, 68, 68, 0.08);
    border: 1px solid rgba(239, 68, 68, 0.3);
    padding: 16px;
    margin-bottom: 24px;
    font-size: 13px;
  }

  .error-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .error-close {
    background: none;
    border: none;
    color: var(--color-failed);
    font-size: 18px;
    cursor: pointer;
    padding: 0;
    line-height: 1;
  }

  .error-message {
    font-family: var(--font-mono);
    font-size: 12px;
    white-space: pre-wrap;
    color: var(--color-failed);
    margin-top: 8px;
  }

  /* Loading */
  .loading {
    text-align: center;
    padding: 60px;
    color: var(--text-muted);
    font-family: var(--font-mono);
  }

  /* Metrics Section */
  .metrics-section {
    display: flex;
    flex-direction: column;
    gap: 16px;
    margin-bottom: 40px;
  }

  .section-label {
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--text-strong);
  }

  .metrics-row {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 24px;
  }

  .metric-card {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 24px;
    border: 1px solid var(--border);
  }

  .metric-label {
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--text-muted);
  }

  .metric-value {
    font-family: var(--font-mono);
    font-size: 28px;
    font-weight: 700;
    color: var(--text-strong);
  }

  .metric-delta {
    display: flex;
    align-items: center;
    gap: 6px;
    font-family: var(--font-body);
    font-size: 12px;
    color: var(--accent);
  }

  .delta-prefix {
    font-family: var(--font-mono);
    font-weight: 700;
  }

  /* Projects Section */
  .projects-section {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .section-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .section-action {
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--accent);
  }

  .empty {
    text-align: center;
    padding: 40px;
    color: var(--text-muted);
    border: 1px solid var(--border);
  }

  .empty code {
    color: var(--accent);
  }

  .project-list {
    border: 1px solid var(--border);
  }

  .project-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 20px;
    gap: 20px;
    cursor: pointer;
    transition: background 0.15s;
    border-bottom: 1px solid var(--border);
  }

  .project-item.last {
    border-bottom: none;
  }

  .project-item:hover {
    background: var(--accent-subtle);
  }

  .project-left {
    display: flex;
    align-items: center;
    gap: 20px;
    min-width: 0;
  }

  .project-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
    background: var(--text-muted);
  }

  .project-dot.passed { background: var(--color-passed); }
  .project-dot.failed { background: var(--color-failed); }
  .project-dot.new { background: var(--color-new); }

  .project-dot.running {
    background: var(--accent);
    animation: pulse 1.5s ease-in-out infinite;
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.3; }
  }

  .project-info {
    display: flex;
    flex-direction: column;
    gap: 4px;
    min-width: 0;
  }

  .project-name {
    font-family: var(--font-mono);
    font-size: 13px;
    color: var(--text-strong);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .project-meta {
    font-family: var(--font-body);
    font-size: 12px;
    color: var(--text-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .project-right {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-shrink: 0;
  }

  .status-badge {
    font-family: var(--font-mono);
    font-size: 12px;
  }

  .status-badge.passed { color: var(--color-passed); }
  .status-badge.failed { color: var(--color-failed); }
  .status-badge.new { color: var(--color-new); }
  .status-badge.none { color: var(--text-muted); }

  /* Progress inline */
  .progress-inline {
    display: flex;
    align-items: center;
    gap: 8px;
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
    min-width: 40px;
  }

  /* Modal */
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
    background: var(--bg);
    border: 1px solid var(--border);
    padding: 32px;
    width: 100%;
    max-width: 420px;
  }

  .modal h2 {
    font-family: var(--font-mono);
    font-size: 18px;
    font-weight: 700;
    color: var(--accent);
    margin-bottom: 24px;
  }

  .modal label {
    display: block;
    margin-bottom: 16px;
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--text-muted);
  }

  .modal input {
    display: block;
    width: 100%;
    margin-top: 8px;
    padding: 10px 12px;
    background: var(--panel-strong);
    border: 1px solid var(--border);
    color: var(--text);
    font-family: var(--font-mono);
    font-size: 13px;
  }

  .modal input:focus {
    outline: none;
    border-color: var(--accent);
  }

  .modal-actions {
    display: flex;
    justify-content: flex-end;
    gap: 12px;
    margin-top: 24px;
  }

  /* Responsive */
  @media (max-width: 900px) {
    .metrics-row {
      grid-template-columns: repeat(2, 1fr);
    }
  }

  @media (max-width: 600px) {
    .page-header {
      flex-direction: column;
      gap: 16px;
    }

    .metrics-row {
      grid-template-columns: 1fr;
    }
  }
</style>
