import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { loadConfigFromPath, resolveConfigPath, loadProjectConfig } from './config-manager.js';

interface TempContext {
  dir: string;
}

async function makeTempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'vrt-config-'));
}

async function writeJsonFile(dir: string, filename: string, payload: unknown): Promise<string> {
  const filepath = join(dir, filename);
  await writeFile(filepath, JSON.stringify(payload, null, 2), 'utf-8');
  return filepath;
}

describe('resolveConfigPath', () => {
  const ctx: TempContext = { dir: '' };

  beforeEach(async () => {
    ctx.dir = await makeTempDir();
  });

  afterEach(async () => {
    await rm(ctx.dir, { recursive: true, force: true });
  });

  it('returns null when no config files exist', () => {
    expect(resolveConfigPath(ctx.dir)).toBeNull();
  });

  it('resolves the explicit config file when provided', async () => {
    const filepath = await writeJsonFile(ctx.dir, 'custom.json', { scenarios: [] });
    expect(resolveConfigPath(ctx.dir, 'custom.json')).toBe(filepath);
  });

  it('prefers vrt.config.json over .vrtrc.json', async () => {
    const vrtPath = await writeJsonFile(ctx.dir, 'vrt.config.json', { scenarios: [] });
    await writeJsonFile(ctx.dir, '.vrtrc.json', { scenarios: [] });
    expect(resolveConfigPath(ctx.dir)).toBe(vrtPath);
  });
});

describe('loadConfigFromPath', () => {
  const ctx: TempContext = { dir: '' };

  beforeEach(async () => {
    ctx.dir = await makeTempDir();
  });

  afterEach(async () => {
    await rm(ctx.dir, { recursive: true, force: true });
  });

  it('throws when the config file is missing', async () => {
    await expect(loadConfigFromPath(join(ctx.dir, 'missing.json'))).rejects.toThrow(
      /Config file not found/
    );
  });

  it('throws when the config JSON is invalid', async () => {
    const filepath = join(ctx.dir, 'vrt.config.json');
    await writeFile(filepath, '{not: valid}', 'utf-8');
    await expect(loadConfigFromPath(filepath)).rejects.toThrow(/Invalid JSON/);
  });

  it('throws when required config fields are missing', async () => {
    const filepath = await writeJsonFile(ctx.dir, 'vrt.config.json', { scenarios: [] });
    await expect(loadConfigFromPath(filepath)).rejects.toThrow(/Invalid config/);
    await expect(loadConfigFromPath(filepath)).rejects.toThrow(/scenarios/);
  });

  it('applies defaults for optional config fields', async () => {
    const filepath = await writeJsonFile(ctx.dir, 'vrt.config.json', {
      scenarios: [{ name: 'Home', url: 'https://example.com' }],
    });

    const config = await loadConfigFromPath(filepath);

    expect(config.threshold).toBe(0.1);
    expect(config.diffColor).toBe('#ff00ff');
    expect(config.disableAnimations).toBe(true);
    expect(config.concurrency).toBe(5);
    expect(config.quickMode).toBe(false);
    expect(config.browsers).toEqual(['chromium']);
    expect(config.viewports).toEqual([{ name: 'desktop', width: 1920, height: 1080 }]);
  });
});

describe('loadProjectConfig', () => {
  const ctx: TempContext = { dir: '' };

  beforeEach(async () => {
    ctx.dir = await makeTempDir();
  });

  afterEach(async () => {
    await rm(ctx.dir, { recursive: true, force: true });
  });

  it('throws when no config files exist in project', async () => {
    await expect(loadProjectConfig(ctx.dir)).rejects.toThrow(/No config file found/);
  });
});
