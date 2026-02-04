import type { Command } from 'commander';
import { readdir } from 'fs/promises';
import { resolve } from 'path';
import { loadConfig } from '../config.js';
import { approveResult } from '../report.js';
import { getProjectDirs } from '../core/paths.js';
import { getErrorMessage } from '../core/errors.js';

export function registerApproveCommand(program: Command): void {
  program
    .command('approve')
    .description('Approve test screenshots as new baselines')
    .argument('[name]', 'Scenario name to approve (or --all)')
    .option('-a, --all', 'Approve all failed tests')
    .option('-c, --config <path>', 'Path to config file')
    .action(async (name, options) => {
      try {
        const config = await loadConfig(options.config);
        const cwd = process.cwd();
        const { outputDir, baselineDir } = getProjectDirs(cwd, config);

        if (!options.all && !name) {
          console.error('Specify a scenario name or use --all');
          process.exit(1);
        }

        const screenshots = (await readdir(outputDir)).filter((file) => file.endsWith('.png'));

        let approved = 0;
        const prefix = options.all ? '' : `${name}_`;

        for (const file of screenshots) {
          if (options.all || file.startsWith(prefix)) {
            const testPath = resolve(outputDir, file);
            await approveResult(testPath, baselineDir);
            console.log(`✓ Approved: ${file}`);
            approved++;
          }
        }

        if (approved === 0) {
          console.log('No screenshots found to approve');
          return;
        }
        console.log(`\nApproved ${approved} screenshot(s)`);
      } catch (err) {
        console.error('Error:', getErrorMessage(err));
        process.exit(1);
      }
    });
}
