import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, copyFile, readFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  getScreenshotFilename,
  getProjectDirs,
  getReportPath,
  getImageMetadataPath,
} from '../../src/core/paths.js';
import { IMAGE_METADATA_SCHEMA_VERSION } from '../../src/core/image-metadata.js';

const FIXTURE_PATH = join(process.cwd(), 'test', 'fixtures', 'baseline.png');

vi.mock('../../src/docker.js', () => ({
  runScreenshotTasks: vi.fn().mockResolvedValue([]),
}));

describe('CLI integration', () => {
  const config = {
    baselineDir: './.vrt/baselines',
    outputDir: './.vrt/output',
    browsers: ['chromium'],
    viewports: [{ name: 'desktop', width: 800, height: 600 }],
    threshold: 0.1,
    scenarios: [{ name: 'homepage', url: 'https://example.com' }],
  };

  let tempDir = '';
  let filename = '';

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'vrt-cli-'));
    await writeFile(join(tempDir, 'vrt.config.json'), JSON.stringify(config, null, 2));

    const { baselineDir, outputDir } = getProjectDirs(tempDir, config);
    await mkdir(baselineDir, { recursive: true });
    await mkdir(outputDir, { recursive: true });

    filename = getScreenshotFilename('homepage', 'chromium', 'desktop');
    await copyFile(FIXTURE_PATH, join(baselineDir, filename));
    await copyFile(FIXTURE_PATH, join(outputDir, filename));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('runs capture, compare, and report pipeline', async () => {
    const originalCwd = process.cwd();
    process.chdir(tempDir);

    try {
      const { createCli } = await import('../../src/cli.js');
      const program = createCli();
      await program.parseAsync(['test', '--config', 'vrt.config.json'], { from: 'user' });

      const docker = await import('../../src/docker.js');
      expect(vi.mocked(docker.runScreenshotTasks)).toHaveBeenCalledTimes(1);

      const reportPath = getReportPath(tempDir, config);
      const reportHtml = await readFile(reportPath, 'utf-8');
      expect(reportHtml).toContain('VRT Report');
      expect(reportHtml).toContain('homepage');

      const { baselineDir, outputDir, diffDir } = getProjectDirs(tempDir, config);
      const baselineMeta = JSON.parse(await readFile(getImageMetadataPath(baselineDir), 'utf-8'));
      const outputMeta = JSON.parse(await readFile(getImageMetadataPath(outputDir), 'utf-8'));
      const diffMeta = JSON.parse(await readFile(getImageMetadataPath(diffDir), 'utf-8'));

      expect(baselineMeta.schemaVersion).toBe(IMAGE_METADATA_SCHEMA_VERSION);
      expect(outputMeta.schemaVersion).toBe(IMAGE_METADATA_SCHEMA_VERSION);
      expect(diffMeta.schemaVersion).toBe(IMAGE_METADATA_SCHEMA_VERSION);
      expect(baselineMeta.images).toHaveProperty(filename);
      expect(outputMeta.images).toHaveProperty(filename);
    } finally {
      process.chdir(originalCwd);
    }
  });
});
