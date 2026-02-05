import type { Command } from 'commander';
import { copyFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import { buildDockerImage, checkDockerImage } from '../docker.js';
import { getProjectDirs } from '../core/paths.js';
import { getErrorMessage } from '../core/errors.js';
import { log } from '../core/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const VRT_ROOT = resolve(__dirname, '..', '..');

function execPromise(cmd: string, options?: { cwd?: string }): Promise<string> {
  return new Promise((resolve, reject) => {
    exec(cmd, options, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(stderr?.toString() || err.message));
      } else {
        resolve(stdout?.toString() || '');
      }
    });
  });
}

async function runBuildStep(options: {
  startLabel: string;
  successLabel: string;
  failureLabel: string;
  command: string;
  cwd: string;
  failureHint: string;
}): Promise<void> {
  log.info(`\n📦 ${options.startLabel}...`);
  try {
    await execPromise(options.command, { cwd: options.cwd });
    log.info(`✓ ${options.successLabel}`);
  } catch (err) {
    log.error(`✗ ${options.failureLabel}:`, getErrorMessage(err));
    log.info(`  Run manually: ${options.failureHint}`);
  }
}

export function registerInitCommand(program: Command): void {
  program
    .command('init')
    .description('Initialize vrtini project with full setup')
    .option('-f, --force', 'Overwrite existing config')
    .option('--skip-build', 'Skip TypeScript, client, and Docker builds')
    .action(async (options) => {
      const cwd = process.cwd();
      const configPath = resolve(cwd, 'vrt.config.json');

      if (existsSync(configPath) && !options.force) {
        log.info('✓ Config file already exists (use --force to overwrite)');
      } else {
        const minimalConfigPath = resolve(VRT_ROOT, 'vrt.config.minimal.json');
        await copyFile(minimalConfigPath, configPath);
        log.info('✓ Created vrt.config.json (from minimal template)');
        log.info('  See vrt.config.full.json5 in the vrtini directory for all options');
      }

      const { baselineDir, outputDir } = getProjectDirs(cwd);
      await mkdir(baselineDir, { recursive: true });
      await mkdir(outputDir, { recursive: true });
      log.info('✓ Created .vrt/baselines/ and .vrt/output/ directories');

      if (options.skipBuild) {
        log.info('\n✓ vrtini initialized (builds skipped)');
        log.info('\nTo complete setup manually:');
        log.info('  1. npm run build (TypeScript)');
        log.info('  2. npm run build:client (Svelte UI)');
        log.info('  3. vrtini build (Docker image)');
        return;
      }

      await runBuildStep({
        startLabel: 'Building TypeScript',
        successLabel: 'TypeScript build complete',
        failureLabel: 'TypeScript build failed',
        command: 'npm run build',
        cwd: VRT_ROOT,
        failureHint: 'cd vrtini && npm run build',
      });
      await runBuildStep({
        startLabel: 'Building Svelte client',
        successLabel: 'Client build complete',
        failureLabel: 'Client build failed',
        command: 'npm run build:client',
        cwd: VRT_ROOT,
        failureHint: 'cd vrtini && npm run build:client',
      });

      const dockerDir = resolve(__dirname, '..', '..', '..', 'docker');
      log.info('\n🐳 Building Docker image...');
      try {
        await buildDockerImage(dockerDir);
        log.info('✓ Docker image built');
      } catch (err) {
        log.error('✗ Docker build failed:', getErrorMessage(err));
        log.info('  Run manually: vrtini build');
      }

      log.info('\n🔍 Validating setup...');
      const hasDocker = await checkDockerImage();
      const hasConfig = existsSync(configPath);
      const hasDirs = existsSync(baselineDir) && existsSync(outputDir);

      if (hasDocker && hasConfig && hasDirs) {
        log.info('✓ All checks passed!\n');
        log.info('vrtini is ready. Run your first test with:');
        log.info('  vrtini test\n');
        log.info('Or start the web UI:');
        log.info('  vrtini serve --open');
      } else {
        log.info('\n⚠ Setup incomplete:');
        if (!hasConfig) log.info('  - Missing config file');
        if (!hasDirs) log.info('  - Missing directories');
        if (!hasDocker) log.info('  - Missing Docker image (run: vrtini build)');
      }
    });
}
