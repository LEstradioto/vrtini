import type { Command } from 'commander';
import { listAvailableVersions, PLAYWRIGHT_VERSIONS } from '../browser-versions.js';

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
  console.log(label);
  versions.forEach((version) => {
    const year = getPlaywrightYear(version, engineKey);
    console.log(`  ${version} (${year})`);
  });
}

export function registerListBrowsersCommand(program: Command): void {
  program
    .command('list-browsers')
    .description('List available browser versions')
    .action(() => {
      const versions = listAvailableVersions();

      console.log('Available browser versions:\n');
      printBrowserVersions('Chromium:', versions.chromium, 'chromiumVersion');
      console.log('');
      printBrowserVersions('WebKit:', versions.webkit, 'webkitVersion');

      console.log('\nConfig example:');
      console.log('  "browsers": [');
      console.log('    "chromium",');
      console.log('    { "name": "chromium", "version": "120" },');
      console.log('    "webkit",');
      console.log('    { "name": "webkit", "version": "17.4" }');
      console.log('  ]');
    });
}
