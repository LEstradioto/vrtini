import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { dirname } from 'path';
import { randomUUID } from 'crypto';
import { getProjectStorePath } from '../../../src/core/paths.js';
import type { Project } from '../../shared/api-types.js';

export interface ProjectStore {
  projects: Project[];
}

function createEmptyStore(): ProjectStore {
  return { projects: [] };
}

function getStorePath(): string {
  if (process.env.VRT_PROJECTS_PATH) {
    return process.env.VRT_PROJECTS_PATH;
  }
  return getProjectStorePath(process.cwd());
}

export async function loadStore(): Promise<ProjectStore> {
  const storePath = getStorePath();

  if (!existsSync(storePath)) {
    return createEmptyStore();
  }

  try {
    const content = await readFile(storePath, 'utf-8');
    return JSON.parse(content) as ProjectStore;
  } catch {
    return createEmptyStore();
  }
}

export async function saveStore(store: ProjectStore): Promise<void> {
  const storePath = getStorePath();
  const dir = dirname(storePath);

  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }

  await writeFile(storePath, JSON.stringify(store, null, 2));
}

export async function getProjects(): Promise<Project[]> {
  const store = await loadStore();
  return store.projects;
}

export async function getProject(id: string): Promise<Project | null> {
  const store = await loadStore();
  return store.projects.find((p) => p.id === id) || null;
}

export async function createProject(data: {
  name: string;
  path: string;
  configFile?: string;
}): Promise<Project> {
  const store = await loadStore();

  const project: Project = {
    id: randomUUID().slice(0, 8),
    name: data.name,
    path: data.path,
    configFile: data.configFile ?? 'vrt.config.json',
    createdAt: new Date().toISOString(),
  };

  store.projects.push(project);
  await saveStore(store);

  return project;
}

export async function updateProject(
  id: string,
  updates: Partial<Omit<Project, 'id' | 'createdAt'>>
): Promise<Project | null> {
  const store = await loadStore();
  const index = store.projects.findIndex((p) => p.id === id);

  if (index === -1) {
    return null;
  }

  store.projects[index] = { ...store.projects[index], ...updates };
  await saveStore(store);

  return store.projects[index];
}

export async function deleteProject(id: string): Promise<boolean> {
  const store = await loadStore();
  const initialLength = store.projects.length;
  store.projects = store.projects.filter((p) => p.id !== id);

  if (store.projects.length === initialLength) {
    return false;
  }

  await saveStore(store);
  return true;
}
