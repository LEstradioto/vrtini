import { getContext, setContext } from 'svelte';
import type { SvelteMap } from 'svelte/reactivity';
import type { Project } from './api';

export interface TestState {
  jobId: string;
  progress: number;
  total: number;
  aborting?: boolean;
  phase?: string;
  error?: string;
  warnings?: string[];
  captureDiagnostics?: TestCaptureDiagnostics;
}

export interface TestCaptureDiagnostics {
  expectedScreenshots: number;
  capturedScreenshots: number;
  expectedSnapshots: number;
  capturedSnapshots: number;
  missingScreenshotSamples: string[];
  missingSnapshotSamples: string[];
}

export interface PersistedTestWarning {
  warnings: string[];
  captureDiagnostics?: TestCaptureDiagnostics;
}

export interface AppContext {
  navigate: (path: string) => void;
  runningTests: SvelteMap<string, TestState>;
  startTest: (project: Project, onComplete?: () => void) => Promise<void>;
  abortTest: (projectId: string) => Promise<void>;
  rerunImage: (
    project: Project,
    filenames: string | string[],
    onComplete?: () => void
  ) => Promise<void>;
  testErrors: SvelteMap<string, string>;
  clearTestError: (projectId: string) => void;
  testWarnings: SvelteMap<string, PersistedTestWarning>;
  clearTestWarning: (projectId: string) => void;
}

const CTX_KEY = Symbol('app');

export function setAppContext(ctx: AppContext): void {
  setContext(CTX_KEY, ctx);
}

export function getAppContext(): AppContext {
  return getContext<AppContext>(CTX_KEY);
}
