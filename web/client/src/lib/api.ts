import type {
  ImageMetadata,
  AcceptanceMetrics,
  Acceptance,
  AcceptanceSignals,
  AutoThresholdCaps,
  AIAnalysisResult,
  CompareResult,
  ImageResult,
  ProjectTiming,
  Project,
  CrossReport,
  CrossResults,
  CrossResultsSummary,
  CrossAcceptance,
  VRTConfig,
} from '../../../shared/api-types.js';

const API_BASE = '/api';

const projectPath = (projectId: string): string => `/projects/${projectId}`;

export type {
  ImageMetadata,
  AcceptanceMetrics,
  Acceptance,
  AcceptanceSignals,
  AutoThresholdCaps,
  AIAnalysisResult,
  CompareResult,
  ImageResult,
  ProjectTiming,
  Project,
  CrossReport,
  CrossResults,
  CrossResultsSummary,
  CrossAcceptance,
  VRTConfig,
};

async function request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  // Only set Content-Type for requests with a body
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string>),
  };
  if (options.body) {
    headers['Content-Type'] = 'application/json';
  }

  const res = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers,
  });

  const data = await res.json();

  if (!res.ok) {
    throw new Error(data.error || 'Request failed');
  }

  return data as T;
}

// Server info
export const info = {
  get: () =>
    request<{
      cwd: string;
      projectName: string;
      existingConfig: string | null;
      hasConfig: boolean;
    }>('/info'),
};

// Projects API
export const projects = {
  list: () => request<{ projects: Project[] }>('/projects'),
  get: (id: string) => request<{ project: Project }>(`/projects/${id}`),
  create: (data: { name: string; path: string; configFile?: string }) =>
    request<{ project: Project }>('/projects', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  update: (id: string, data: Partial<Project>) =>
    request<{ project: Project }>(`${projectPath(id)}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),
  delete: (id: string) => request<{ success: boolean }>(`${projectPath(id)}`, { method: 'DELETE' }),
};

// Config API
export const config = {
  get: (projectId: string) =>
    request<{
      config: VRTConfig;
      raw: unknown;
      valid: boolean;
      errors: unknown[] | null;
    }>(`${projectPath(projectId)}/config`),
  save: (projectId: string, config: VRTConfig) =>
    request<{ success: boolean; config: VRTConfig }>(`${projectPath(projectId)}/config`, {
      method: 'PUT',
      body: JSON.stringify({ config }),
    }),
  schema: () =>
    request<{
      browsers: string[];
      waitForOptions: string[];
      aiProviders: string[];
      severityLevels: string[];
      changeCategories: string[];
      ruleActions: string[];
    }>('/schema'),
};

// Images API
export const images = {
  list: (projectId: string) =>
    request<{
      baselines: string[];
      tests: string[];
      diffs: string[];
      paths: { baselineDir: string; outputDir: string; diffDir: string };
      metadata: {
        baselines: ImageMetadata[];
        tests: ImageMetadata[];
        diffs: ImageMetadata[];
      };
      acceptances: Record<string, Acceptance>;
      autoThresholdCaps: AutoThresholdCaps;
    }>(`${projectPath(projectId)}/images`),
  getUrl: (
    projectId: string,
    type: 'baseline' | 'test' | 'diff' | 'custom-diff',
    filename: string
  ) => `${API_BASE}/projects/${projectId}/images/${type}/${filename}`,
  getFileUrl: (projectId: string, relativePath: string) =>
    `${API_BASE}/projects/${projectId}/files?path=${encodeURIComponent(relativePath)}`,
  approve: (projectId: string, filename: string) =>
    request<{ success: boolean; approved: string }>(`${projectPath(projectId)}/approve`, {
      method: 'POST',
      body: JSON.stringify({ filename }),
    }),
  reject: (projectId: string, filename: string) =>
    request<{ success: boolean; rejected: string }>(`${projectPath(projectId)}/reject`, {
      method: 'POST',
      body: JSON.stringify({ filename }),
    }),
  bulkApprove: (projectId: string, filenames: string[]) =>
    request<{
      success: boolean;
      approved: string[];
      failed: Array<{ filename: string; error: string }>;
    }>(`${projectPath(projectId)}/bulk-approve`, {
      method: 'POST',
      body: JSON.stringify({ filenames }),
    }),
  revert: (projectId: string, filename: string) =>
    request<{ success: boolean; reverted: string }>(
      `${projectPath(projectId)}/revert/${encodeURIComponent(filename)}`,
      { method: 'POST' }
    ),
  getResults: (projectId: string) =>
    request<{ results: Record<string, ImageResult> }>(`${projectPath(projectId)}/results`),
};

// Compare API
export const compare = {
  custom: (
    projectId: string,
    left: { type: string; filename: string },
    right: { type: string; filename: string },
    threshold?: number
  ) =>
    request<CompareResult>(`${projectPath(projectId)}/compare`, {
      method: 'POST',
      body: JSON.stringify({ left, right, threshold }),
    }),
};

// Cross-compare API
export const crossCompare = {
  run: (projectId: string) =>
    request<{ reports: CrossReport[] }>(`${projectPath(projectId)}/cross-compare`, {
      method: 'POST',
    }),
  getResults: (projectId: string, key: string) =>
    request<{ results: CrossResults }>(`${projectPath(projectId)}/cross-results/${key}`),
  list: (projectId: string) =>
    request<{ results: CrossResultsSummary[] }>(`${projectPath(projectId)}/cross-results`),
  clear: (projectId: string, key: string) =>
    request<{ success: boolean }>(`${projectPath(projectId)}/cross-results/${key}`, {
      method: 'DELETE',
    }),
  deleteItems: (projectId: string, key: string, itemKeys: string[]) =>
    request<{ success: boolean; deleted: string[]; missing: string[] }>(
      `${projectPath(projectId)}/cross-delete`,
      {
        method: 'POST',
        body: JSON.stringify({ key, itemKeys }),
      }
    ),
  accept: (projectId: string, key: string, itemKey: string, reason?: string) =>
    request<{ success: boolean; acceptance: CrossAcceptance }>(
      `${projectPath(projectId)}/cross-accept`,
      {
        method: 'POST',
        body: JSON.stringify({ key, itemKey, reason }),
      }
    ),
  revoke: (projectId: string, key: string, itemKey: string) =>
    request<{ success: boolean }>(
      `${projectPath(projectId)}/cross-accept/${key}/${encodeURIComponent(itemKey)}`,
      {
        method: 'DELETE',
      }
    ),
};

// Acceptance API
export const acceptance = {
  list: (projectId: string) =>
    request<{
      acceptances: Acceptance[];
      acceptanceMap: Record<string, Acceptance>;
    }>(`${projectPath(projectId)}/acceptances`),
  create: (
    projectId: string,
    data: {
      filename: string;
      reason?: string;
      comparedAgainst: { filename: string; type: 'baseline' | 'test' };
      metrics: AcceptanceMetrics;
      signals?: AcceptanceSignals;
    }
  ) =>
    request<{ success: boolean; acceptance: Acceptance }>(`${projectPath(projectId)}/accept`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  revoke: (projectId: string, filename: string) =>
    request<{ success: boolean; revoked: string }>(
      `${projectPath(projectId)}/accept/${encodeURIComponent(filename)}`,
      { method: 'DELETE' }
    ),
};

// AI Analysis API
export const analyze = {
  run: (
    projectId: string,
    items: Array<{
      baseline: { type: 'baseline' | 'test'; filename: string };
      test: { type: 'baseline' | 'test'; filename: string };
      diff?: { type: 'diff' | 'custom-diff'; filename: string };
      name?: string;
    }>
  ) =>
    request<{
      results: Array<{
        filename: string;
        analysis?: AIAnalysisResult;
        error?: string;
      }>;
    }>(`/projects/${projectId}/analyze`, {
      method: 'POST',
      body: JSON.stringify({ items }),
    }),
};

// Test API
export const test = {
  run: (projectId: string, scenarios?: string[]) =>
    request<{ jobId: string; status: string; total: number }>(`${projectPath(projectId)}/test`, {
      method: 'POST',
      body: JSON.stringify({ scenarios }),
    }),
  status: (projectId: string, jobId: string) =>
    request<{
      id: string;
      status: 'running' | 'completed' | 'failed' | 'aborted';
      progress: number;
      total: number;
      phase: 'capturing' | 'comparing' | 'done';
      results: unknown[];
      error?: string;
      timing?: ProjectTiming;
    }>(`${projectPath(projectId)}/test/${jobId}`),
  abort: (projectId: string, jobId: string) =>
    request<{
      status: 'aborted';
      progress: number;
      total: number;
      results: unknown[];
    }>(`${projectPath(projectId)}/test/${jobId}/abort`, {
      method: 'POST',
    }),
  rerun: (projectId: string, filenames: string | string[]) =>
    request<{ jobId: string; status: string; total: number; failed?: string[] }>(
      `${projectPath(projectId)}/test/rerun`,
      {
        method: 'POST',
        body: JSON.stringify(Array.isArray(filenames) ? { filenames } : { filename: filenames }),
      }
    ),
  stream: (projectId: string, jobId: string) =>
    new EventSource(`${projectPath(projectId)}/test/${jobId}/stream`),
};
