/**
 * Read/write JSON documents on disk with:
 *  - atomic writes via temp file + rename
 *  - `log.warn` on corrupt JSON instead of silent data loss
 *  - automatic parent-dir creation
 *
 * Use this for any small JSON state file (acceptances, flags, deletions,
 * projects store, etc.) — NOT for streaming/large data.
 */

import { existsSync } from 'fs';
import { mkdir, readFile, rename, writeFile } from 'fs/promises';
import { dirname } from 'path';
import { randomUUID } from 'crypto';
import { getErrorMessage } from './errors.js';
import { log } from './logger.js';

export async function loadJsonFile<T>(path: string, fallback: T): Promise<T> {
  if (!existsSync(path)) return fallback;
  let raw: string;
  try {
    raw = await readFile(path, 'utf-8');
  } catch (err) {
    log.warn(`Failed to read ${path}: ${getErrorMessage(err)} — using fallback.`);
    return fallback;
  }
  try {
    return JSON.parse(raw) as T;
  } catch (err) {
    log.warn(
      `Corrupt JSON in ${path}: ${getErrorMessage(err)} — using fallback. Backing up as ${path}.corrupt.`
    );
    try {
      await writeFile(`${path}.corrupt`, raw);
    } catch {
      // best-effort backup
    }
    return fallback;
  }
}

export async function saveJsonFile(path: string, data: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${randomUUID()}.tmp`;
  await writeFile(tmp, JSON.stringify(data, null, 2));
  await rename(tmp, path);
}
