import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  loadConfigFromPath,
  resolveConfigPath,
  loadProjectConfig,
  listProfileConfigs,
  extractProfileName,
  deepMergeConfigs,
} from './config-manager.js';

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

  it('resolves vrtini.config.json at the project root', async () => {
    const vrtPath = await writeJsonFile(ctx.dir, 'vrtini.config.json', { scenarios: [] });
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
    const filepath = join(ctx.dir, 'vrtini.config.json');
    await writeFile(filepath, '{not: valid}', 'utf-8');
    await expect(loadConfigFromPath(filepath)).rejects.toThrow(/Invalid JSON/);
  });

  it('throws when required config fields are missing', async () => {
    const filepath = await writeJsonFile(ctx.dir, 'vrtini.config.json', { scenarios: [] });
    await expect(loadConfigFromPath(filepath)).rejects.toThrow(/Invalid config/);
    await expect(loadConfigFromPath(filepath)).rejects.toThrow(/scenarios/);
  });

  it('applies defaults for optional config fields', async () => {
    const filepath = await writeJsonFile(ctx.dir, 'vrtini.config.json', {
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

describe('extractProfileName', () => {
  it('returns "default" for vrtini.config.json', () => {
    expect(extractProfileName('vrtini.config.json')).toBe('default');
  });

  it('extracts the profile segment from vrtini.<name>.config.json', () => {
    expect(extractProfileName('vrtini.chrome.config.json')).toBe('chrome');
    expect(extractProfileName('vrtini.cross-webkit.config.json')).toBe('cross-webkit');
  });

  it('strips directory prefix before matching', () => {
    expect(extractProfileName('/tmp/project/vrtini.mobile.config.json')).toBe('mobile');
  });

  it('returns null for non-vrtini filenames', () => {
    expect(extractProfileName('config.json')).toBeNull();
    expect(extractProfileName('vrt.config.json')).toBeNull();
    expect(extractProfileName('vrtini.config.js')).toBeNull();
  });
});

describe('deepMergeConfigs', () => {
  it('merges nested objects and overrides primitives', () => {
    const base = { threshold: 0.1, engines: { pixelmatch: { enabled: true, alpha: 0.1 } } };
    const override = { threshold: 0.2, engines: { pixelmatch: { alpha: 0.5 } } };
    const merged = deepMergeConfigs(base, override);
    expect(merged).toEqual({
      threshold: 0.2,
      engines: { pixelmatch: { enabled: true, alpha: 0.5 } },
    });
  });

  it('replaces arrays rather than concatenating', () => {
    const base = { scenarios: [{ name: 'a', url: 'http://x' }] };
    const override = { scenarios: [{ name: 'b', url: 'http://y' }] };
    expect(deepMergeConfigs(base, override)).toEqual({
      scenarios: [{ name: 'b', url: 'http://y' }],
    });
  });
});

describe('listProfileConfigs', () => {
  const ctx: TempContext = { dir: '' };

  beforeEach(async () => {
    ctx.dir = await makeTempDir();
  });
  afterEach(async () => {
    await rm(ctx.dir, { recursive: true, force: true });
  });

  it('returns an empty list when no vrtini configs exist', async () => {
    expect(await listProfileConfigs(ctx.dir)).toEqual([]);
  });

  it('lists default and named profiles and sorts default first', async () => {
    await writeJsonFile(ctx.dir, 'vrtini.config.json', {});
    await writeJsonFile(ctx.dir, 'vrtini.chrome.config.json', {});
    await writeJsonFile(ctx.dir, 'vrtini.webkit.config.json', {});
    await writeJsonFile(ctx.dir, 'unrelated.json', {});

    const profiles = await listProfileConfigs(ctx.dir);
    expect(profiles.map((p) => p.name)).toEqual(['default', 'chrome', 'webkit']);
  });
});

describe('extends and profile defaults', () => {
  const ctx: TempContext = { dir: '' };

  beforeEach(async () => {
    ctx.dir = await makeTempDir();
  });
  afterEach(async () => {
    await rm(ctx.dir, { recursive: true, force: true });
  });

  it('merges base config via extends', async () => {
    await writeJsonFile(ctx.dir, 'vrtini.base.config.json', {
      threshold: 0.2,
      browsers: ['chromium'],
      viewports: [{ name: 'desktop', width: 1920, height: 1080 }],
      scenarios: [{ name: 'home', url: 'https://example.com' }],
    });
    const chromePath = await writeJsonFile(ctx.dir, 'vrtini.chrome.config.json', {
      extends: './vrtini.base.config.json',
      browsers: [{ name: 'chromium', version: '130' }],
    });

    const config = await loadConfigFromPath(chromePath);
    expect(config.threshold).toBe(0.2);
    expect(config.browsers).toEqual([{ name: 'chromium', version: '130' }]);
    expect(config.scenarios).toHaveLength(1);
  });

  it('throws on circular extends', async () => {
    const aPath = join(ctx.dir, 'vrtini.a.config.json');
    const bPath = join(ctx.dir, 'vrtini.b.config.json');
    await writeFile(aPath, JSON.stringify({ extends: './vrtini.b.config.json' }), 'utf-8');
    await writeFile(bPath, JSON.stringify({ extends: './vrtini.a.config.json' }), 'utf-8');
    await expect(loadConfigFromPath(aPath)).rejects.toThrow(/Circular extends/);
  });

  it('defaults baselineDir/outputDir to profile-scoped paths for named profiles', async () => {
    const filepath = await writeJsonFile(ctx.dir, 'vrtini.chrome.config.json', {
      scenarios: [{ name: 'home', url: 'https://example.com' }],
    });
    const config = await loadConfigFromPath(filepath);
    expect(config.baselineDir).toBe('./.vrtini/chrome/baselines');
    expect(config.outputDir).toBe('./.vrtini/chrome/output');
  });

  it('keeps default baselineDir/outputDir for vrtini.config.json (default profile)', async () => {
    const filepath = await writeJsonFile(ctx.dir, 'vrtini.config.json', {
      scenarios: [{ name: 'home', url: 'https://example.com' }],
    });
    const config = await loadConfigFromPath(filepath);
    expect(config.baselineDir).toBe('./.vrtini/baselines');
    expect(config.outputDir).toBe('./.vrtini/output');
  });

  it('respects user-provided baselineDir/outputDir on named profiles', async () => {
    const filepath = await writeJsonFile(ctx.dir, 'vrtini.chrome.config.json', {
      baselineDir: './custom/baselines',
      outputDir: './custom/output',
      scenarios: [{ name: 'home', url: 'https://example.com' }],
    });
    const config = await loadConfigFromPath(filepath);
    expect(config.baselineDir).toBe('./custom/baselines');
    expect(config.outputDir).toBe('./custom/output');
  });
});
