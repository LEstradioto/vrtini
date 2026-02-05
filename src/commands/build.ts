import type { Command } from 'commander';
import { existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { buildDockerImage, checkDockerImage } from '../docker.js';
import { getRequiredPlaywrightVersions, LATEST_PLAYWRIGHT_VERSION } from '../browser-versions.js';
import { resolveConfigPath, loadConfigFromPath } from '../core/config-manager.js';
import { getErrorMessage } from '../core/errors.js';
import { log } from '../core/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function buildVersions(dockerDir: string, versions: string[]): Promise<void> {
  for (const version of versions) {
    await buildDockerImage(dockerDir, version);
    log.info('');
  }
}

function findConfigFile(): string | null {
  return resolveConfigPath(process.cwd());
}

export function registerBuildCommand(program: Command): void {
  program
    .command('build')
    .description('Build Docker images for screenshot capture')
    .option('-p, --playwright <version>', 'Playwright version to build (e.g., 1.49.1, 1.40.0)')
    .option('--all-versions', 'Build all supported Playwright versions')
    .option('--force', 'Rebuild even if image already exists')
    .action(async (options) => {
      const dockerDir = resolve(__dirname, '..', '..', '..', 'docker');

      if (!existsSync(dockerDir)) {
        log.error(`Docker directory not found: ${dockerDir}`);
        process.exit(1);
      }

      try {
        if (options.allVersions) {
          // Build all supported versions
          const { PLAYWRIGHT_VERSIONS } = await import('../browser-versions.js');
          const versions = Object.keys(PLAYWRIGHT_VERSIONS);
          log.info(`Building ${versions.length} Docker images...\n`);
          await buildVersions(dockerDir, versions);
          log.info(`\n✓ Built ${versions.length} images successfully`);
        } else if (options.playwright) {
          // Build specific version
          await buildDockerImage(dockerDir, options.playwright);
        } else {
          // Auto-detect from config
          const configPath = findConfigFile();
          let requiredVersions: string[];

          if (configPath) {
            const config = await loadConfigFromPath(configPath);
            requiredVersions = getRequiredPlaywrightVersions(config.browsers);
            log.info(`Found config: ${configPath}`);
            log.info(`Browsers configured: ${config.browsers.length}`);
          } else {
            requiredVersions = [LATEST_PLAYWRIGHT_VERSION];
            log.info(`No config found, building latest version`);
          }

          log.info(`Required Playwright versions: ${requiredVersions.join(', ')}\n`);

          // Check which images already exist
          const toBuild: string[] = [];
          for (const version of requiredVersions) {
            const imageTag = `vrt-playwright:v${version}`;
            const exists = await checkDockerImage(imageTag);
            if (exists && !options.force) {
              log.info(`✓ ${imageTag} already exists (skip)`);
            } else {
              toBuild.push(version);
            }
          }

          if (toBuild.length === 0) {
            log.info(`\nAll required Docker images are ready!`);
            log.info(`Use --force to rebuild existing images.`);
            return;
          }

          log.info(`\nBuilding ${toBuild.length} Docker image(s)...\n`);
          await buildVersions(dockerDir, toBuild);
          log.info(`\n✓ Built ${toBuild.length} image(s) successfully`);
        }
      } catch (err) {
        log.error('Failed to build Docker image:', getErrorMessage(err));
        process.exit(1);
      }
    });
}
