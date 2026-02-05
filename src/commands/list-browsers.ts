import type { Command } from 'commander';
import { listAvailableVersions, PLAYWRIGHT_VERSIONS } from '../browser-versions.js';
import { log } from '../core/logger.js';

type BrowserEngineKey = 'chromiumVersion' | 'webkitVersion';

function getPlaywrightYear(version: string, engineKey: BrowserEngineKey): string {
  const entry = Object.entries(PLAYWRIGHT_VERSIONS).find(
    ([_, info]) => info[engineKey] === version
  );
  return entry ? String(entry[1].year) : '';
}

function printBrowserVersions(
  label: string,
  versions: string[],
  engineKey: BrowserEngineKey
): void {
  log.info(label);
  versions.forEach((version) => {
    const year = getPlaywrightYear(version, engineKey);
    log.info(`  ${version} (${year})`);
  });
}

export function registerListBrowsersCommand(program: Command): void {
  program
    .command('list-browsers')
    .description('List available browser versions')
    .action(() => {
      const versions = listAvailableVersions();

      log.info('Available browser versions:\n');
      printBrowserVersions('Chromium:', versions.chromium, 'chromiumVersion');
      log.info('');
      printBrowserVersions('WebKit:', versions.webkit, 'webkitVersion');

      log.info('\nConfig example:');
      log.info('  "browsers": [');
      log.info('    "chromium",');
      log.info('    { "name": "chromium", "version": "120" },');
      log.info('    "webkit",');
      log.info('    { "name": "webkit", "version": "17.4" }');
      log.info('  ]');
    });
}
