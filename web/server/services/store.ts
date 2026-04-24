import { randomUUID } from 'crypto';
import { getProjectStorePath } from '../../../src/core/paths.js';
import { loadJsonFile, saveJsonFile } from '../../../src/core/json-file-store.js';
import { readProjectsPath } from '../../../src/core/env.js';
import type { Project } from '../../shared/api-types.js';

interface ProjectStore {
  projects: Project[];
}

function getStorePath(): string {
  return readProjectsPath() ?? getProjectStorePath(process.cwd());
}

async function loadStore(): Promise<ProjectStore> {
  return loadJsonFile<ProjectStore>(getStorePath(), { projects: [] });
}

async function saveStore(store: ProjectStore): Promise<void> {
  await saveJsonFile(getStorePath(), store);
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
    configFile: data.configFile ?? 'vrtini.config.json',
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
