/**
 * Decode a captured screenshot filename back into its components.
 * Inverse of `getScreenshotFilename` in core/paths.
 * Pure — no I/O.
 */

export const UNKNOWN_COMPONENT = 'unknown';

export interface ImageNameParts {
  filename: string;
  scenario: string;
  browser: string;
  version?: string;
  viewport: string;
}

const BROWSER_SEGMENT_RE = /^(chromium|webkit)(?:-v(\d+(?:\.\d+)*))?$/i;

export function parseImageFilename(filename: string): ImageNameParts {
  const name = filename.replace(/\.png$/, '');
  const parts = name.split('_');

  if (parts.length < 3) {
    return { filename, scenario: name, browser: UNKNOWN_COMPONENT, viewport: UNKNOWN_COMPONENT };
  }

  // Scenario names may contain underscores, so search for the browser segment
  // rather than assuming it's at parts[1].
  for (let i = 1; i < parts.length - 1; i++) {
    const match = parts[i].match(BROWSER_SEGMENT_RE);
    if (match) {
      return {
        filename,
        scenario: parts.slice(0, i).join('_'),
        browser: match[1],
        version: match[2],
        viewport: parts.slice(i + 1).join('_'),
      };
    }
  }

  return { filename, scenario: parts[0], browser: parts[1], viewport: parts.slice(2).join('_') };
}
