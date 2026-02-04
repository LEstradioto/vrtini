import { defineConfig } from '@playwright/test';
import { resolve } from 'node:path';

const port = process.env.PW_PORT ? Number(process.env.PW_PORT) : 4173;
const host = process.env.PW_HOST ?? '0.0.0.0';
const baseHost = process.env.PW_BASE_HOST ?? '127.0.0.1';
const storePath =
  process.env.VRT_PROJECTS_PATH ?? resolve(process.cwd(), 'test', 'temp', 'ui-smoke-projects.json');

process.env.VRT_PROJECTS_PATH = storePath;

export default defineConfig({
  testDir: 'test/ui',
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  use: {
    baseURL: `http://${baseHost}:${port}`,
    headless: true,
  },
  webServer: {
    command: `node dist/src/index.js serve --port ${port} --host ${host}`,
    port,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      VRT_PROJECTS_PATH: storePath,
    },
  },
});
