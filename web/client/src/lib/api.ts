import type { ZodType } from 'zod';
import type {
  ImageMetadata,
  AcceptanceMetrics,
  Acceptance,
  AcceptanceSignals,
  AutoThresholdCaps,
  AIAnalysisResult,
  AIProviderStatus,
  AIProviderStatusResponse,
  CompareResult,
  ImageResult,
  ProjectTiming,
  Project,
  CrossReport,
  CrossResultItem,
  CrossResults,
  CrossResultsSummary,
  CrossAcceptance,
  VRTConfig,
  Scenario,
  ScenarioOptions,
  BrowserConfig,
} from '../../../shared/api-types.js';
import {
  InfoResponseSchema,
  ProjectListResponseSchema,
  ProjectResponseSchema,
  SuccessResponseSchema,
  ConfigGetResponseSchema,
  ConfigSaveResponseSchema,
  SchemaResponseSchema,
  ImagesListResponseSchema,
  ApproveResponseSchema,
  RejectResponseSchema,
  BulkApproveResponseSchema,
  RevertResponseSchema,
  ImageResultsResponseSchema,
  CompareResultSchema,
  CrossCompareRunResponseSchema,
  CrossResultsResponseSchema,
  CrossResultsListResponseSchema,
  CrossDeleteResponseSchema,
  CrossAcceptResponseSchema,
  AcceptanceListResponseSchema,
  AcceptanceCreateResponseSchema,
  RevokeResponseSchema,
  AnalyzeResponseSchema,
  AIProviderStatusResponseSchema,
  TestRunResponseSchema,
  TestStatusResponseSchema,
  TestAbortResponseSchema,
  TestRerunResponseSchema,
} from '../../../shared/api-schemas.js';

const API_BASE = '/api';

const projectPath = (projectId: string): string => `/projects/${projectId}`;

export type {
  ImageMetadata,
  AcceptanceMetrics,
  Acceptance,
  AcceptanceSignals,
  AutoThresholdCaps,
  AIAnalysisResult,
  AIProviderStatus,
  AIProviderStatusResponse,
  CompareResult,
  ImageResult,
  ProjectTiming,
  Project,
  CrossReport,
  CrossResultItem,
  CrossResults,
  CrossResultsSummary,
  CrossAcceptance,
  VRTConfig,
  Scenario,
  ScenarioOptions,
  BrowserConfig,
};

async function request<T>(
  endpoint: string,
  options: RequestInit = {},
  schema?: ZodType<T>
): Promise<T> {
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

  if (schema) {
    const result = schema.safeParse(data);
    if (!result.success) {
      console.warn(`[api] Response validation failed for ${endpoint}:`, result.error.issues);
      // Return raw data as fallback so the app doesn't break on minor schema drift
      return data as T;
    }
    return result.data;
  }

  return data as T;
}

// Server info
export const info = {
  get: () => request('/info', {}, InfoResponseSchema),
};

// Projects API
export const projects = {
  list: () => request('/projects', {}, ProjectListResponseSchema),
  get: (id: string) => request(`/projects/${id}`, {}, ProjectResponseSchema),
  create: (data: { name: string; path: string; configFile?: string }) =>
    request(
      '/projects',
      {
        method: 'POST',
        body: JSON.stringify(data),
      },
      ProjectResponseSchema
    ),
  update: (id: string, data: Partial<Project>) =>
    request(
      `${projectPath(id)}`,
      {
        method: 'PUT',
        body: JSON.stringify(data),
      },
      ProjectResponseSchema
    ),
  delete: (id: string) =>
    request(`${projectPath(id)}`, { method: 'DELETE' }, SuccessResponseSchema),
};

// Config API
export const config = {
  get: (projectId: string) =>
    request(`${projectPath(projectId)}/config`, {}, ConfigGetResponseSchema),
  save: (projectId: string, config: VRTConfig) =>
    request(
      `${projectPath(projectId)}/config`,
      {
        method: 'PUT',
        body: JSON.stringify({ config }),
      },
      ConfigSaveResponseSchema
    ),
  schema: () => request('/schema', {}, SchemaResponseSchema),
};

// Images API
export const images = {
  list: (projectId: string) =>
    request(`${projectPath(projectId)}/images`, {}, ImagesListResponseSchema),
  getUrl: (
    projectId: string,
    type: 'baseline' | 'test' | 'diff' | 'custom-diff',
    filename: string
  ) => `${API_BASE}/projects/${projectId}/images/${type}/${filename}`,
  getFileUrl: (projectId: string, relativePath: string) =>
    `${API_BASE}/projects/${projectId}/files?path=${encodeURIComponent(relativePath)}`,
  approve: (projectId: string, filename: string) =>
    request(
      `${projectPath(projectId)}/approve`,
      {
        method: 'POST',
        body: JSON.stringify({ filename }),
      },
      ApproveResponseSchema
    ),
  reject: (projectId: string, filename: string) =>
    request(
      `${projectPath(projectId)}/reject`,
      {
        method: 'POST',
        body: JSON.stringify({ filename }),
      },
      RejectResponseSchema
    ),
  bulkApprove: (projectId: string, filenames: string[]) =>
    request(
      `${projectPath(projectId)}/bulk-approve`,
      {
        method: 'POST',
        body: JSON.stringify({ filenames }),
      },
      BulkApproveResponseSchema
    ),
  revert: (projectId: string, filename: string) =>
    request(
      `${projectPath(projectId)}/revert/${encodeURIComponent(filename)}`,
      { method: 'POST' },
      RevertResponseSchema
    ),
  getResults: (projectId: string) =>
    request(`${projectPath(projectId)}/results`, {}, ImageResultsResponseSchema),
};

// Compare API
export const compare = {
  custom: (
    projectId: string,
    left: { type: string; filename: string },
    right: { type: string; filename: string },
    threshold?: number
  ) =>
    request(
      `${projectPath(projectId)}/compare`,
      {
        method: 'POST',
        body: JSON.stringify({ left, right, threshold }),
      },
      CompareResultSchema
    ),
};

// Cross-compare API
export const crossCompare = {
  run: (
    projectId: string,
    options?: {
      key?: string;
      itemKeys?: string[];
      scenarios?: string[];
      viewports?: string[];
      resetAcceptances?: boolean;
    }
  ) =>
    request(
      `${projectPath(projectId)}/cross-compare`,
      {
        method: 'POST',
        body: options ? JSON.stringify(options) : undefined,
      },
      CrossCompareRunResponseSchema
    ),
  getResults: (projectId: string, key: string) =>
    request(`${projectPath(projectId)}/cross-results/${key}`, {}, CrossResultsResponseSchema),
  list: (projectId: string) =>
    request(`${projectPath(projectId)}/cross-results`, {}, CrossResultsListResponseSchema),
  clear: (projectId: string, key: string) =>
    request(
      `${projectPath(projectId)}/cross-results/${key}`,
      {
        method: 'DELETE',
      },
      SuccessResponseSchema
    ),
  deleteItems: (projectId: string, key: string, itemKeys: string[]) =>
    request(
      `${projectPath(projectId)}/cross-delete`,
      {
        method: 'POST',
        body: JSON.stringify({ key, itemKeys }),
      },
      CrossDeleteResponseSchema
    ),
  accept: (projectId: string, key: string, itemKey: string, reason?: string) =>
    request(
      `${projectPath(projectId)}/cross-accept`,
      {
        method: 'POST',
        body: JSON.stringify({ key, itemKey, reason }),
      },
      CrossAcceptResponseSchema
    ),
  revoke: (projectId: string, key: string, itemKey: string) =>
    request(
      `${projectPath(projectId)}/cross-accept/${key}/${encodeURIComponent(itemKey)}`,
      {
        method: 'DELETE',
      },
      SuccessResponseSchema
    ),
  aiTriage: (projectId: string, key: string, itemKeys?: string[]) =>
    request<{ results: Array<{ itemKey: string; analysis?: AIAnalysisResult; error?: string }> }>(
      `${projectPath(projectId)}/cross-compare/${key}/ai-triage`,
      {
        method: 'POST',
        body: JSON.stringify(itemKeys?.length ? { itemKeys } : {}),
      }
    ),
};

// Acceptance API
export const acceptance = {
  list: (projectId: string) =>
    request(`${projectPath(projectId)}/acceptances`, {}, AcceptanceListResponseSchema),
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
    request(
      `${projectPath(projectId)}/accept`,
      {
        method: 'POST',
        body: JSON.stringify(data),
      },
      AcceptanceCreateResponseSchema
    ),
  revoke: (projectId: string, filename: string) =>
    request(
      `${projectPath(projectId)}/accept/${encodeURIComponent(filename)}`,
      { method: 'DELETE' },
      RevokeResponseSchema
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
    request(
      `/projects/${projectId}/analyze`,
      {
        method: 'POST',
        body: JSON.stringify({ items }),
      },
      AnalyzeResponseSchema
    ),
  providerStatus: (projectId: string) =>
    request(`/projects/${projectId}/analyze/providers`, {}, AIProviderStatusResponseSchema),
};

// Test API
export const test = {
  run: (projectId: string, scenarios?: string[]) =>
    request(
      `${projectPath(projectId)}/test`,
      {
        method: 'POST',
        body: JSON.stringify({ scenarios }),
      },
      TestRunResponseSchema
    ),
  status: (projectId: string, jobId: string) =>
    request(`${projectPath(projectId)}/test/${jobId}`, {}, TestStatusResponseSchema),
  abort: (projectId: string, jobId: string) =>
    request(
      `${projectPath(projectId)}/test/${jobId}/abort`,
      {
        method: 'POST',
      },
      TestAbortResponseSchema
    ),
  rerun: (projectId: string, filenames: string | string[]) =>
    request(
      `${projectPath(projectId)}/test/rerun`,
      {
        method: 'POST',
        body: JSON.stringify(Array.isArray(filenames) ? { filenames } : { filename: filenames }),
      },
      TestRerunResponseSchema
    ),
  stream: (projectId: string, jobId: string) =>
    new EventSource(`${projectPath(projectId)}/test/${jobId}/stream`),
};
