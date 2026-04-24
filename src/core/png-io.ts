/**
 * PNG file I/O helpers used by the comparison pipeline and AI chunking.
 * Thin wrappers around pngjs — centralized so the read/write error handling
 * and the "file might not exist" convention stay consistent.
 */

import { existsSync } from 'fs';
import { readFile, writeFile } from 'fs/promises';
import { PNG } from 'pngjs';

/**
 * Parse a PNG file. Throws if the file can't be read or parsed.
 * Uses the async pngjs parser so large images don't block the event loop.
 */
export async function loadPng(path: string): Promise<PNG> {
  const data = await readFile(path);
  return new Promise<PNG>((resolve, reject) => {
    const png = new PNG();
    png.parse(data, (err, parsed) => {
      if (err) return reject(err);
      if (!parsed) return reject(new Error('Failed to parse PNG.'));
      resolve(parsed);
    });
  });
}

/**
 * Parse a PNG if it exists and is readable. Returns null otherwise.
 * Use for optional inputs (snapshots, diff images) where "not present" and
 * "corrupt" are both fine to treat as absence.
 */
export async function loadPngSafely(path?: string): Promise<PNG | null> {
  if (!path || !existsSync(path)) return null;
  try {
    const data = await readFile(path);
    return PNG.sync.read(data);
  } catch {
    return null;
  }
}

/** Write a PNG to disk (synchronous encode, async write). */
export async function writePng(path: string, png: PNG): Promise<void> {
  await writeFile(path, PNG.sync.write(png));
}
