#!/usr/bin/env bash
set -euo pipefail

Xvfb :99 -screen 0 1280x720x24 &
fluxbox &

x11vnc -display :99 -nopw -forever -shared -rfbport 5900 &
websockify --web=/usr/share/novnc/ 6080 localhost:5900 &

node - <<'NODE'
const { chromium, webkit } = require('playwright');

const browserName = (process.env.BROWSER || 'chromium').toLowerCase();
const launchArgs = ['--no-sandbox', '--disable-dev-shm-usage'];

async function main() {
  const browserType = browserName === 'webkit' ? webkit : chromium;
  const browser = await browserType.launch({ headless: false, args: launchArgs });
  const page = await browser.newPage();
  await page.goto(process.env.TARGET_URL || 'http://host.docker.internal:3000');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
NODE

wait -n
