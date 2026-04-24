/**
 * Persistent JSON stores for cross-compare state.
 * Three parallel {pairKey → {itemKey → record}} shapes:
 *  - acceptances: user-approved cross-browser diffs
 *  - deletions: items removed from a pair's results
 *  - flags: items flagged for review
 *
 * Uses the generic atomic JsonFileStore primitive underneath.
 */

import { resolve } from 'path';
import { loadJsonFile, saveJsonFile } from '../../../src/core/json-file-store.js';

export interface CrossAcceptanceRecord {
  acceptedAt: string;
  reason?: string;
}

export interface CrossFlagRecord {
  flaggedAt: string;
  reason?: string;
}

export type CrossAcceptanceStore = Record<string, Record<string, CrossAcceptanceRecord>>;
export type CrossDeletionStore = Record<string, Record<string, { deletedAt: string }>>;
export type CrossFlagStore = Record<string, Record<string, CrossFlagRecord>>;

function getCrossAcceptancesPath(projectPath: string): string {
  return resolve(projectPath, '.vrtini', 'acceptances', 'cross.json');
}

function getCrossDeletionsPath(projectPath: string): string {
  return resolve(projectPath, '.vrtini', 'acceptances', 'cross-deleted.json');
}

function getCrossFlagsPath(projectPath: string): string {
  return resolve(projectPath, '.vrtini', 'acceptances', 'cross-flags.json');
}

export const loadCrossAcceptances = (projectPath: string) =>
  loadJsonFile<CrossAcceptanceStore>(getCrossAcceptancesPath(projectPath), {});
export const saveCrossAcceptances = (projectPath: string, data: CrossAcceptanceStore) =>
  saveJsonFile(getCrossAcceptancesPath(projectPath), data);

export const loadCrossDeletions = (projectPath: string) =>
  loadJsonFile<CrossDeletionStore>(getCrossDeletionsPath(projectPath), {});
export const saveCrossDeletions = (projectPath: string, data: CrossDeletionStore) =>
  saveJsonFile(getCrossDeletionsPath(projectPath), data);

export const loadCrossFlags = (projectPath: string) =>
  loadJsonFile<CrossFlagStore>(getCrossFlagsPath(projectPath), {});
export const saveCrossFlags = (projectPath: string, data: CrossFlagStore) =>
  saveJsonFile(getCrossFlagsPath(projectPath), data);

/** Drop all per-item deletions for a pair. */
export async function clearCrossDeletions(projectPath: string, key: string): Promise<void> {
  const deletions = await loadCrossDeletions(projectPath);
  if (!deletions[key]) return;
  const { [key]: _removed, ...rest } = deletions;
  void _removed;
  await saveCrossDeletions(projectPath, rest);
}

/** Drop specific per-item deletions within a pair. Removes the pair entry if it becomes empty. */
export async function clearCrossDeletionsForItems(
  projectPath: string,
  key: string,
  itemKeys: string[]
): Promise<void> {
  if (itemKeys.length === 0) return;
  const deletions = await loadCrossDeletions(projectPath);
  const pairDeletions = deletions[key];
  if (!pairDeletions) return;

  const itemKeySet = new Set(itemKeys);
  const nextEntries = Object.entries(pairDeletions).filter(([itemKey]) => !itemKeySet.has(itemKey));

  if (nextEntries.length === Object.keys(pairDeletions).length) return;

  if (nextEntries.length === 0) {
    const { [key]: _removed, ...rest } = deletions;
    void _removed;
    await saveCrossDeletions(projectPath, rest);
    return;
  }

  await saveCrossDeletions(projectPath, {
    ...deletions,
    [key]: Object.fromEntries(nextEntries),
  });
}
