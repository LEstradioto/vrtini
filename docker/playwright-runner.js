#!/usr/bin/env node

/**
 * Playwright Runner - Runs inside Docker container
 *
 * Reads scenario config from /input/scenario.json
 * Saves screenshot to /output/<name>_<browser>_<viewport>.png
 */

const { chromium, webkit } = require('playwright');
const fs = require('fs');
const path = require('path');

const INPUT_DIR = '/input';
const OUTPUT_DIR = '/output';
const CONFIG_FILE = path.join(INPUT_DIR, 'scenario.json');

/**
 * Sanitize a string for use in filenames.
 * Replaces problematic characters with safe alternatives.
 */
function sanitizeForFilename(name) {
  return name
    .replace(/[\/\\]/g, '-') // Replace path separators with dash
    .replace(/[<>:"|?*]/g, '_') // Replace other illegal chars with underscore
    .replace(/\s+/g, '_') // Replace whitespace with underscore
    .replace(/-+/g, '-') // Collapse multiple dashes
    .replace(/_+/g, '_') // Collapse multiple underscores
    .replace(/^[-_]+|[-_]+$/g, ''); // Trim leading/trailing dashes/underscores
}

async function main() {
  // Read scenario config
  if (!fs.existsSync(CONFIG_FILE)) {
    console.error(`Config file not found: ${CONFIG_FILE}`);
    process.exit(1);
  }

  const config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
  const { scenario, browser: browserName, viewport, disableAnimations = true } = config;

  console.log(
    `Running: ${scenario.name} | ${browserName} | ${viewport.name} (${viewport.width}x${viewport.height})`
  );

  // Launch browser
  const browserType = browserName === 'webkit' ? webkit : chromium;
  const browser = await browserType.launch({
    headless: true,
  });

  try {
    const context = await browser.newContext({
      viewport: {
        width: viewport.width,
        height: viewport.height,
      },
      deviceScaleFactor: 1,
    });

    const page = await context.newPage();

    // Block matching URLs if configured (substring match)
    const blockUrls = Array.isArray(scenario.blockUrls)
      ? scenario.blockUrls.filter((p) => typeof p === 'string' && p.length > 0)
      : [];
    if (blockUrls.length > 0) {
      await page.route('**/*', (route) => {
        const url = route.request().url();
        if (blockUrls.some((pattern) => url.includes(pattern))) {
          return route.abort();
        }
        return route.continue();
      });
    }

    // Navigate to URL
    const waitUntil = scenario.waitFor || 'load';
    console.log(`Navigating to ${scenario.url} (waitUntil: ${waitUntil})`);

    await page.goto(scenario.url, {
      waitUntil:
        waitUntil === 'networkidle'
          ? 'networkidle'
          : waitUntil === 'domcontentloaded'
            ? 'domcontentloaded'
            : 'load',
      timeout: 30000,
    });

    // Wait for specific selector if provided
    if (scenario.waitForSelector) {
      console.log(`Waiting for selector: ${scenario.waitForSelector}`);
      await page.waitForSelector(scenario.waitForSelector, { timeout: 10000 });
    }

    // Additional timeout if specified
    if (scenario.waitForTimeout) {
      console.log(`Waiting additional ${scenario.waitForTimeout}ms`);
      await page.waitForTimeout(scenario.waitForTimeout);
    }

    // Execute custom JavaScript before screenshot
    if (scenario.beforeScreenshot) {
      console.log('Executing beforeScreenshot script');
      await page.evaluate(scenario.beforeScreenshot);
      // Small delay to let any DOM changes settle
      await page.waitForTimeout(100);
    }
    if (scenario.postInteractionWait) {
      console.log(`Waiting postInteractionWait ${scenario.postInteractionWait}ms`);
      await page.waitForTimeout(scenario.postInteractionWait);
    }

    // Hide selectors (visibility: hidden - preserves layout)
    if (scenario.hideSelectors && scenario.hideSelectors.length > 0) {
      console.log(`Hiding ${scenario.hideSelectors.length} selectors`);
      const hideCSS = scenario.hideSelectors
        .map((sel) => `${sel} { visibility: hidden !important; }`)
        .join('\n');
      await page.addStyleTag({ content: hideCSS });
    }

    // Remove selectors (display: none - collapses space)
    if (scenario.removeSelectors && scenario.removeSelectors.length > 0) {
      console.log(`Removing ${scenario.removeSelectors.length} selectors`);
      const removeCSS = scenario.removeSelectors
        .map((sel) => `${sel} { display: none !important; }`)
        .join('\n');
      await page.addStyleTag({ content: removeCSS });
    }

    // Disable CSS animations and transitions to prevent flaky screenshots
    if (disableAnimations) {
      console.log('Disabling CSS animations and transitions');
      await page.addStyleTag({
        content: `
          *, *::before, *::after {
            animation-duration: 0s !important;
            animation-delay: 0s !important;
            transition-duration: 0s !important;
            transition-delay: 0s !important;
            scroll-behavior: auto !important;
          }
        `,
      });
      // Small delay to ensure styles are applied
      await page.waitForTimeout(50);
    }

    // Take screenshot
    const sanitizedName = sanitizeForFilename(scenario.name);
    const screenshotName = `${sanitizedName}_${browserName}_${viewport.name}.png`;
    const screenshotPath = path.join(OUTPUT_DIR, screenshotName);

    if (scenario.selector) {
      // Capture specific element
      console.log(`Capturing element: ${scenario.selector}`);
      const element = await page.$(scenario.selector);
      if (!element) {
        throw new Error(`Selector not found: ${scenario.selector}`);
      }
      await element.screenshot({ path: screenshotPath });
    } else {
      // Capture viewport or full page
      await page.screenshot({
        path: screenshotPath,
        fullPage: scenario.fullPage || false,
      });
    }

    console.log(`Screenshot saved: ${screenshotName}`);

    await context.close();
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  } finally {
    await browser.close();
  }

  console.log('Done');
  process.exit(0);
}

main().catch((error) => {
  console.error(`Fatal error: ${error.message}`);
  process.exit(1);
});
