import { test, expect, type Page } from '@playwright/test';
import { mkdir, rm, writeFile, copyFile, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { getScreenshotFilename } from '../../src/core/paths.js';

const FIXTURES_DIR = resolve(process.cwd(), 'test', 'fixtures');
const TEMP_ROOT = resolve(process.cwd(), 'test', 'temp', 'ui-smoke-project');
const STORE_PATH = process.env.VRT_PROJECTS_PATH ?? resolve(process.cwd(), '.vrt', 'projects.json');

const PROJECT_ID = 'smoke1234';
const PROJECT_NAME = 'UI Smoke Project';
const CONFIG_FILE = 'vrt.config.json';
const SCENARIO = 'homepage';
const VIEWPORT = 'desktop';
const BROWSER = 'chromium';

let storeBackup: string | null = null;

type ContrastSample = { ratio: number; foreground: string; background: string };

async function getBodyContrast(page: Page): Promise<ContrastSample> {
  return page.evaluate(() => {
    const style = getComputedStyle(document.body);
    const foreground = style.color;
    const background = style.backgroundColor;

    const parseRgb = (value: string): [number, number, number] => {
      const match = value.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
      if (!match) return [0, 0, 0];
      return [Number(match[1]), Number(match[2]), Number(match[3])];
    };

    const toLuminance = ([r, g, b]: [number, number, number]): number => {
      const convert = (channel: number) => {
        const srgb = channel / 255;
        return srgb <= 0.03928 ? srgb / 12.92 : Math.pow((srgb + 0.055) / 1.055, 2.4);
      };
      const [rL, gL, bL] = [convert(r), convert(g), convert(b)];
      return 0.2126 * rL + 0.7152 * gL + 0.0722 * bL;
    };

    const fgLum = toLuminance(parseRgb(foreground));
    const bgLum = toLuminance(parseRgb(background));
    const [bright, dark] = fgLum >= bgLum ? [fgLum, bgLum] : [bgLum, fgLum];
    const ratio = (bright + 0.05) / (dark + 0.05);

    return { ratio, foreground, background };
  });
}

async function seedProject(): Promise<void> {
  const baselineDir = resolve(TEMP_ROOT, '.vrt', 'baselines');
  const outputDir = resolve(TEMP_ROOT, '.vrt', 'output');
  const diffDir = resolve(outputDir, 'diffs');

  await mkdir(baselineDir, { recursive: true });
  await mkdir(outputDir, { recursive: true });
  await mkdir(diffDir, { recursive: true });

  const baselinePath = join(FIXTURES_DIR, 'baseline.png');
  const modifiedPath = join(FIXTURES_DIR, 'modified.png');

  if (!existsSync(baselinePath) || !existsSync(modifiedPath)) {
    throw new Error('Test fixtures not found. Run: npx tsx test/generate-test-fixtures.ts');
  }

  const filename = getScreenshotFilename(SCENARIO, BROWSER, VIEWPORT);
  await copyFile(baselinePath, resolve(baselineDir, filename));
  await copyFile(modifiedPath, resolve(outputDir, filename));
  await copyFile(modifiedPath, resolve(diffDir, filename));

  const config = {
    baselineDir: './.vrt/baselines',
    outputDir: './.vrt/output',
    browsers: [BROWSER],
    viewports: [{ name: VIEWPORT, width: 800, height: 600 }],
    threshold: 0.1,
    diffThreshold: { maxDiffPercentage: 100 },
    disableAnimations: true,
    diffColor: '#ff00ff',
    scenarios: [{ name: SCENARIO, url: 'https://example.com' }],
  };

  await writeFile(resolve(TEMP_ROOT, CONFIG_FILE), JSON.stringify(config, null, 2), 'utf-8');
}

test.beforeAll(async () => {
  if (existsSync(STORE_PATH)) {
    storeBackup = await readFile(STORE_PATH, 'utf-8');
  }

  await mkdir(resolve(process.cwd(), '.vrt'), { recursive: true });

  const project = {
    id: PROJECT_ID,
    name: PROJECT_NAME,
    path: TEMP_ROOT,
    configFile: CONFIG_FILE,
    createdAt: new Date().toISOString(),
  };

  await seedProject();
  await writeFile(STORE_PATH, JSON.stringify({ projects: [project] }, null, 2), 'utf-8');
});

test.afterAll(async () => {
  if (storeBackup !== null) {
    await writeFile(STORE_PATH, storeBackup, 'utf-8');
  } else if (existsSync(STORE_PATH)) {
    await rm(STORE_PATH, { force: true });
  }

  await rm(TEMP_ROOT, { recursive: true, force: true });
});

test('dashboard -> project -> compare -> cross', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible();

  const projectCard = page.getByRole('button', { name: new RegExp(PROJECT_NAME) });
  await expect(projectCard).toBeVisible();
  await projectCard.click();

  await expect(page.getByRole('button', { name: 'Compare Tool' })).toBeVisible();

  await page.getByRole('button', { name: 'Compare Tool' }).click();
  await expect(page.getByText('Select two images above to compare them')).toBeVisible();

  const compareSelector = page.locator('.compare-selector');
  const leftSearch = compareSelector.locator('.selector-col').nth(0).locator('input.search-input');
  const rightSearch = compareSelector.locator('.selector-col').nth(1).locator('input.search-input');

  await leftSearch.click();
  await compareSelector.locator('.selector-col').nth(0).locator('.dropdown-item').first().click();

  await rightSearch.click();
  await compareSelector.locator('.selector-col').nth(1).locator('.dropdown-item').first().click();

  await page.getByRole('button', { name: 'Compare Images' }).click();
  await expect(page.getByText('Pixel Diff')).toBeVisible();

  await page.locator('.compare-images .compare-image-card').first().click();
  const gallery = page.getByRole('dialog', { name: 'Image Gallery' });
  await expect(gallery).toBeVisible();
  const zoomLevel = gallery.locator('.zoom-level');
  const activeView = gallery.locator('.view-tab.active');
  const imageContainer = gallery.locator('.image-container');
  const columnModeSelect = gallery.locator('#column-mode');

  await gallery.getByRole('button', { name: /Left/ }).click();
  await gallery.getByRole('button', { name: /Right/ }).click();
  await gallery.getByRole('button', { name: /Diff/ }).click();

  await page.keyboard.press('W');
  await expect(zoomLevel).toHaveText('100%');

  await page.keyboard.press('=');
  await expect(zoomLevel).toHaveText('110%');

  await page.keyboard.press('-');
  await expect(zoomLevel).toHaveText('100%');

  await page.keyboard.press('2');
  await expect(activeView).toHaveText(/Right/);

  await page.keyboard.press('3');
  await expect(activeView).toHaveText(/Diff/);

  await page.keyboard.press('1');
  await expect(activeView).toHaveText(/Left/);

  await columnModeSelect.selectOption('2');
  await page.keyboard.press('F');
  await expect(columnModeSelect).toHaveValue(/\d+/);

  for (let i = 0; i < 10; i++) {
    await page.keyboard.press('=');
  }

  await expect(zoomLevel).toHaveText('200%');

  const overflow = await imageContainer.evaluate((el) => ({
    x: el.scrollWidth > el.clientWidth,
    y: el.scrollHeight > el.clientHeight,
  }));

  if (overflow.x || overflow.y) {
    const beforeScroll = await imageContainer.evaluate((el) => ({
      left: el.scrollLeft,
      top: el.scrollTop,
    }));
    const box = await imageContainer.boundingBox();
    if (!box) throw new Error('Image container missing for drag test.');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 - 120, box.y + box.height / 2 - 120);
    await page.mouse.up();
    const afterScroll = await imageContainer.evaluate((el) => ({
      left: el.scrollLeft,
      top: el.scrollTop,
    }));
    expect(
      afterScroll.left !== beforeScroll.left || afterScroll.top !== beforeScroll.top
    ).toBeTruthy();
  }

  const zoomBeforeFitHeight = await zoomLevel.textContent();
  await page.keyboard.press('H');
  await expect(zoomLevel).not.toHaveText(zoomBeforeFitHeight ?? '');

  await gallery.getByRole('button', { name: 'Close' }).click();
  await expect(gallery).toBeHidden();

  await page.getByRole('button', { name: 'Cross' }).click();
  await expect(
    page.getByText('Run cross compare to generate results for browser pairs.')
  ).toBeVisible();
});

test('theme persists and maintains contrast', async ({ page }) => {
  await page.goto('/');

  const html = page.locator('html');
  const toggle = page.getByRole('button', { name: /Light|Dark/ });

  const initialTheme = await html.getAttribute('data-theme');
  const initialContrast = await getBodyContrast(page);
  expect(initialTheme).toBeTruthy();
  expect(initialContrast.ratio).toBeGreaterThanOrEqual(4.5);

  await toggle.click();

  const toggledTheme = await html.getAttribute('data-theme');
  if (!toggledTheme) throw new Error('Theme not set after toggle.');
  expect(toggledTheme).not.toEqual(initialTheme);

  const storedTheme = await page.evaluate(() => localStorage.getItem('vrt-theme'));
  expect(storedTheme).toBe(toggledTheme);

  const toggledContrast = await getBodyContrast(page);
  expect(toggledContrast.ratio).toBeGreaterThanOrEqual(4.5);

  await page.reload();
  await expect(html).toHaveAttribute('data-theme', toggledTheme);

  const persistedContrast = await getBodyContrast(page);
  expect(persistedContrast.ratio).toBeGreaterThanOrEqual(4.5);
});
