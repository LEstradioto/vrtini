import { exec } from 'child_process';

function getOpenCommand(platform: NodeJS.Platform): string {
  if (platform === 'darwin') return 'open';
  if (platform === 'win32') return 'start';
  return 'xdg-open';
}

export function openInBrowser(filePath: string): void {
  const cmd = getOpenCommand(process.platform);
  exec(`${cmd} "${filePath}"`, (err) => {
    if (err) {
      console.error(`Failed to open browser: ${err.message}`);
    }
  });
}
