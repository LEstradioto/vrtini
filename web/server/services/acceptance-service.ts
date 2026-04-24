import { resolve } from 'path';
import { getAcceptancesPath } from '../../../src/core/paths.js';
import { loadJsonFile, saveJsonFile } from '../../../src/core/json-file-store.js';
import type { Acceptance, ImageFlag } from '../../../src/domain/acceptance.js';

interface AcceptancesFile {
  acceptances: Acceptance[];
}

interface ImageFlagsFile {
  flags: ImageFlag[];
}

// ─── Acceptances ─────────────────────────────────────────────────────────────

export async function loadAcceptances(projectPath: string): Promise<Acceptance[]> {
  const data = await loadJsonFile<AcceptancesFile>(getAcceptancesPath(projectPath), {
    acceptances: [],
  });
  return data.acceptances || [];
}

async function saveAcceptances(projectPath: string, acceptances: Acceptance[]): Promise<void> {
  await saveJsonFile(getAcceptancesPath(projectPath), { acceptances } satisfies AcceptancesFile);
}

export function acceptancesToMap(acceptances: Acceptance[]): Record<string, Acceptance> {
  const map: Record<string, Acceptance> = {};
  for (const a of acceptances) {
    map[a.filename] = a;
  }
  return map;
}

export async function createAcceptance(
  projectPath: string,
  acceptance: Omit<Acceptance, 'acceptedAt'>
): Promise<Acceptance> {
  const acceptances = await loadAcceptances(projectPath);
  const filtered = acceptances.filter((a) => a.filename !== acceptance.filename);

  const newAcceptance: Acceptance = {
    ...acceptance,
    acceptedAt: new Date().toISOString(),
  };

  filtered.push(newAcceptance);
  await saveAcceptances(projectPath, filtered);

  return newAcceptance;
}

export async function revokeAcceptance(projectPath: string, filename: string): Promise<boolean> {
  const acceptances = await loadAcceptances(projectPath);
  const filtered = acceptances.filter((a) => a.filename !== filename);

  if (filtered.length === acceptances.length) return false;

  await saveAcceptances(projectPath, filtered);
  return true;
}

// ─── Image flags ─────────────────────────────────────────────────────────────

function getImageFlagsPath(projectPath: string): string {
  return resolve(projectPath, '.vrtini', 'acceptances', 'flags.json');
}

export async function loadImageFlags(projectPath: string): Promise<ImageFlag[]> {
  const data = await loadJsonFile<ImageFlagsFile>(getImageFlagsPath(projectPath), { flags: [] });
  return data.flags || [];
}

async function saveImageFlags(projectPath: string, flags: ImageFlag[]): Promise<void> {
  await saveJsonFile(getImageFlagsPath(projectPath), { flags } satisfies ImageFlagsFile);
}

export function imageFlagsToMap(flags: ImageFlag[]): Record<string, ImageFlag> {
  const map: Record<string, ImageFlag> = {};
  for (const flag of flags) {
    map[flag.filename] = flag;
  }
  return map;
}

export async function setImageFlag(
  projectPath: string,
  flag: Omit<ImageFlag, 'flaggedAt'>
): Promise<ImageFlag> {
  const flags = await loadImageFlags(projectPath);
  const filtered = flags.filter((entry) => entry.filename !== flag.filename);

  const next: ImageFlag = {
    ...flag,
    flaggedAt: new Date().toISOString(),
  };

  filtered.push(next);
  await saveImageFlags(projectPath, filtered);
  return next;
}

export async function revokeImageFlag(projectPath: string, filename: string): Promise<boolean> {
  const flags = await loadImageFlags(projectPath);
  const filtered = flags.filter((entry) => entry.filename !== filename);

  if (filtered.length === flags.length) return false;

  await saveImageFlags(projectPath, filtered);
  return true;
}
