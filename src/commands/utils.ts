import { execFile } from 'child_process';
import { getErrorMessage } from '../core/errors.js';
import { log } from '../core/logger.js';

function getOpenCommand(platform: NodeJS.Platform): string {
  if (platform === 'darwin') return 'open';
  if (platform === 'win32') return 'start';
  return 'xdg-open';
}

export function openInBrowser(filePath: string): void {
  const cmd = getOpenCommand(process.platform);
  execFile(cmd, [filePath], (err) => {
    if (err) {
      log.error(`Failed to open browser: ${getErrorMessage(err)}`);
    }
  });
}
