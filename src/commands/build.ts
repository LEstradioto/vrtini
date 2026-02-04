import type { Command } from 'commander';
import { existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { buildDockerImage, checkDockerImage } from '../docker.js';
import { getRequiredPlaywrightVersions, LATEST_PLAYWRIGHT_VERSION } from '../browser-versions.js';
import { resolveConfigPath, loadConfigFromPath } from '../core/config-manager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function buildVersions(dockerDir: string, versions: string[]): Promise<void> {
  for (const version of versions) {
    await buildDockerImage(dockerDir, version);
    console.log('');
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
        console.error(`Docker directory not found: ${dockerDir}`);
        process.exit(1);
      }

      try {
        if (options.allVersions) {
          // Build all supported versions
          const { PLAYWRIGHT_VERSIONS } = await import('../browser-versions.js');
          const versions = Object.keys(PLAYWRIGHT_VERSIONS);
          console.log(`Building ${versions.length} Docker images...\n`);
          await buildVersions(dockerDir, versions);
          console.log(`\n✓ Built ${versions.length} images successfully`);
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
            console.log(`Found config: ${configPath}`);
            console.log(`Browsers configured: ${config.browsers.length}`);
          } else {
            requiredVersions = [LATEST_PLAYWRIGHT_VERSION];
            console.log(`No config found, building latest version`);
          }

          console.log(`Required Playwright versions: ${requiredVersions.join(', ')}\n`);

          // Check which images already exist
          const toBuild: string[] = [];
          for (const version of requiredVersions) {
            const imageTag = `vrt-playwright:v${version}`;
            const exists = await checkDockerImage(imageTag);
            if (exists && !options.force) {
              console.log(`✓ ${imageTag} already exists (skip)`);
            } else {
              toBuild.push(version);
            }
          }

          if (toBuild.length === 0) {
            console.log(`\nAll required Docker images are ready!`);
            console.log(`Use --force to rebuild existing images.`);
            return;
          }

          console.log(`\nBuilding ${toBuild.length} Docker image(s)...\n`);
          await buildVersions(dockerDir, toBuild);
          console.log(`\n✓ Built ${toBuild.length} image(s) successfully`);
        }
      } catch (err) {
        console.error('Failed to build Docker image:', err);
        process.exit(1);
      }
    });
}
