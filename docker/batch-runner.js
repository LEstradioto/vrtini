#!/usr/bin/env node

/**
 * Batch Runner - Runs inside Docker container
 *
 * Performance optimization: Single browser launch for multiple screenshots.
 * Reduces ~0.5-1s browser launch overhead per screenshot.
 *
 * Reads batch config from /input/batch.json
 * Saves screenshots to /output/<name>_<browser>_<viewport>.png
 *
 * Input format:
 * {
 *   "browser": "chromium" | "webkit",
 *   "browserDisplayName": "chromium" | "chromium-v120" | etc (optional, defaults to browser),
 *   "concurrency": 5 (optional, parallel page limit, default: 5),
 *   "tasks": [
 *     { "scenario": {...}, "viewport": {...}, "disableAnimations": true },
 *     ...
 *   ]
 * }
 */

const { chromium, webkit } = require('playwright');
const fs = require('fs');
const path = require('path');

const { captureDomSnapshot } = require('./dom-snapshot.js');

const INPUT_DIR = '/input';
const OUTPUT_DIR = '/output';
const CONFIG_FILE = path.join(INPUT_DIR, 'batch.json');

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

/**
 * Simple concurrency limiter (p-limit pattern without external deps)
 */
function createLimiter(concurrency) {
  let active = 0;
  const queue = [];

  const next = () => {
    if (queue.length > 0 && active < concurrency) {
      active++;
      const { fn, resolve, reject } = queue.shift();
      fn()
        .then(resolve)
        .catch(reject)
        .finally(() => {
          active--;
          next();
        });
    }
  };

  return (fn) =>
    new Promise((resolve, reject) => {
      queue.push({ fn, resolve, reject });
      next();
    });
}

/**
 * Take a screenshot for a single task
 * @param {object} browser - Playwright browser instance
 * @param {string} browserName - Base browser name (chromium/webkit) for Playwright
 * @param {string} browserDisplayName - Display name for filenames (e.g., "chromium-v120")
 * @param {object} task - Task config
 */
async function runTask(browser, browserName, browserDisplayName, task) {
  const { scenario, viewport, disableAnimations = true } = task;
  const taskId = `${scenario.name}|${browserDisplayName}|${viewport.name}`;

  console.log(`[START] ${taskId}`);

  const context = await browser.newContext({
    viewport: {
      width: viewport.width,
      height: viewport.height,
    },
    deviceScaleFactor: 1,
  });

  const page = await context.newPage();

  try {
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
      await page.waitForSelector(scenario.waitForSelector, { timeout: 10000 });
    }

    // Additional timeout if specified
    if (scenario.waitForTimeout) {
      await page.waitForTimeout(scenario.waitForTimeout);
    }

    // Execute custom JavaScript before screenshot
    if (scenario.beforeScreenshot) {
      await page.evaluate(scenario.beforeScreenshot);
      await page.waitForTimeout(100);
    }
    if (scenario.postInteractionWait) {
      await page.waitForTimeout(scenario.postInteractionWait);
    }

    // Hide selectors (visibility: hidden - preserves layout)
    if (scenario.hideSelectors && scenario.hideSelectors.length > 0) {
      const hideCSS = scenario.hideSelectors
        .map((sel) => `${sel} { visibility: hidden !important; }`)
        .join('\n');
      await page.addStyleTag({ content: hideCSS });
    }

    // Remove selectors (display: none - collapses space)
    if (scenario.removeSelectors && scenario.removeSelectors.length > 0) {
      const removeCSS = scenario.removeSelectors
        .map((sel) => `${sel} { display: none !important; }`)
        .join('\n');
      await page.addStyleTag({ content: removeCSS });
    }

    // Disable CSS animations and transitions
    if (disableAnimations) {
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
      await page.waitForTimeout(50);
    }

    // Take screenshot (use display name for filename, includes version if any)
    const sanitizedName = sanitizeForFilename(scenario.name);
    const screenshotName = `${sanitizedName}_${browserDisplayName}_${viewport.name}.png`;
    const screenshotPath = path.join(OUTPUT_DIR, screenshotName);

    if (scenario.selector) {
      const element = await page.$(scenario.selector);
      if (!element) {
        throw new Error(`Selector not found: ${scenario.selector}`);
      }
      await element.screenshot({ path: screenshotPath });
    } else {
      await page.screenshot({
        path: screenshotPath,
        fullPage: scenario.fullPage || false,
      });
    }

    // Capture DOM snapshot if requested (non-fatal)
    let snapshotName;
    if (task.captureSnapshot) {
      try {
        const maxElements = task.captureSnapshot.maxElements || 2000;
        const snapshot = await page.evaluate(captureDomSnapshot, maxElements);
        snapshotName = screenshotName.replace(/\.png$/, '.snapshot.json');
        fs.writeFileSync(path.join(OUTPUT_DIR, snapshotName), JSON.stringify(snapshot));
      } catch (snapshotErr) {
        console.warn(`[WARN] Snapshot failed for ${taskId}: ${snapshotErr.message}`);
      }
    }

    console.log(`[OK] ${taskId} -> ${screenshotName}`);
    return { taskId, success: true, screenshot: screenshotName, snapshot: snapshotName };
  } catch (error) {
    console.error(`[FAIL] ${taskId}: ${error.message}`);
    // Still capture whatever the browser shows (error page, blank, etc.)
    try {
      const sanitizedName = sanitizeForFilename(scenario.name);
      const screenshotName = `${sanitizedName}_${browserDisplayName}_${viewport.name}.png`;
      const screenshotPath = path.join(OUTPUT_DIR, screenshotName);
      // Navigate to about:blank first to ensure page is in a stable state.
      // WebKit leaves the page broken after connection-refused errors,
      // making direct screenshots fail.
      try {
        await page.goto('about:blank', { timeout: 5000 });
      } catch {
        /* ignore */
      }
      await page.screenshot({ path: screenshotPath, fullPage: false });
      console.log(`[CAPTURED] ${taskId} -> ${screenshotName} (after error)`);
      return { taskId, success: true, screenshot: screenshotName, warning: error.message };
    } catch (screenshotError) {
      console.error(
        `[SKIP] ${taskId}: could not capture error screenshot: ${screenshotError.message}`
      );
      return { taskId, success: false, error: error.message };
    }
  } finally {
    await context.close();
  }
}

async function main() {
  // Read batch config
  if (!fs.existsSync(CONFIG_FILE)) {
    console.error(`Config file not found: ${CONFIG_FILE}`);
    process.exit(1);
  }

  const config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
  const { browser: browserName, browserDisplayName, concurrency = 5, tasks } = config;
  // Use browserDisplayName for filenames (defaults to browserName if not provided)
  const displayName = browserDisplayName || browserName;

  if (!tasks || tasks.length === 0) {
    console.error('No tasks provided');
    process.exit(1);
  }

  console.log(`=== Batch Runner ===`);
  console.log(`Browser: ${displayName}`);
  console.log(`Tasks: ${tasks.length}`);
  console.log(`Concurrency: ${concurrency}`);
  console.log(`====================`);

  // Launch browser ONCE (use base browserName for Playwright)
  const browserType = browserName === 'webkit' ? webkit : chromium;
  const browser = await browserType.launch({ headless: true });

  const startTime = Date.now();
  const limit = createLimiter(concurrency);

  let results;
  try {
    // Run tasks in parallel with concurrency limit
    results = await Promise.all(
      tasks.map((task) => limit(() => runTask(browser, browserName, displayName, task)))
    );
  } finally {
    await browser.close();
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
  const succeeded = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;

  console.log(`====================`);
  console.log(`Completed: ${succeeded}/${tasks.length} (${failed} failed)`);
  console.log(`Time: ${elapsed}s`);

  // Write results summary
  const resultsPath = path.join(OUTPUT_DIR, 'batch-results.json');
  fs.writeFileSync(
    resultsPath,
    JSON.stringify(
      {
        browser: displayName,
        totalTasks: tasks.length,
        succeeded,
        failed,
        elapsedSeconds: parseFloat(elapsed),
        results,
      },
      null,
      2
    )
  );

  // Exit with error if any tasks failed
  if (failed > 0) {
    process.exit(1);
  }

  process.exit(0);
}

main().catch((error) => {
  console.error(`Fatal error: ${error.message}`);
  process.exit(1);
});
