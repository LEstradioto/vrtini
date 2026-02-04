import type { Command } from 'commander';
import { copyFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import { buildDockerImage, checkDockerImage } from '../docker.js';
import { getProjectDirs } from '../core/paths.js';
import { getErrorMessage } from '../core/errors.js';

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
  console.log(`\n📦 ${options.startLabel}...`);
  try {
    await execPromise(options.command, { cwd: options.cwd });
    console.log(`✓ ${options.successLabel}`);
  } catch (err) {
    console.error(`✗ ${options.failureLabel}:`, getErrorMessage(err));
    console.log(`  Run manually: ${options.failureHint}`);
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
        console.log('✓ Config file already exists (use --force to overwrite)');
      } else {
        const minimalConfigPath = resolve(VRT_ROOT, 'vrt.config.minimal.json');
        await copyFile(minimalConfigPath, configPath);
        console.log('✓ Created vrt.config.json (from minimal template)');
        console.log('  See vrt.config.full.json5 in the vrtini directory for all options');
      }

      const { baselineDir, outputDir } = getProjectDirs(cwd);
      await mkdir(baselineDir, { recursive: true });
      await mkdir(outputDir, { recursive: true });
      console.log('✓ Created .vrt/baselines/ and .vrt/output/ directories');

      if (options.skipBuild) {
        console.log('\n✓ vrtini initialized (builds skipped)');
        console.log('\nTo complete setup manually:');
        console.log('  1. npm run build (TypeScript)');
        console.log('  2. npm run build:client (Svelte UI)');
        console.log('  3. vrtini build (Docker image)');
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
      console.log('\n🐳 Building Docker image...');
      try {
        await buildDockerImage(dockerDir);
        console.log('✓ Docker image built');
      } catch (err) {
        console.error('✗ Docker build failed:', getErrorMessage(err));
        console.log('  Run manually: vrtini build');
      }

      console.log('\n🔍 Validating setup...');
      const hasDocker = await checkDockerImage();
      const hasConfig = existsSync(configPath);
      const hasDirs = existsSync(baselineDir) && existsSync(outputDir);

      if (hasDocker && hasConfig && hasDirs) {
        console.log('✓ All checks passed!\n');
        console.log('vrtini is ready. Run your first test with:');
        console.log('  vrtini test\n');
        console.log('Or start the web UI:');
        console.log('  vrtini serve --open');
      } else {
        console.log('\n⚠ Setup incomplete:');
        if (!hasConfig) console.log('  - Missing config file');
        if (!hasDirs) console.log('  - Missing directories');
        if (!hasDocker) console.log('  - Missing Docker image (run: vrtini build)');
      }
    });
}
