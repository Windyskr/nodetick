import { defineConfig } from '@playwright/test';

/**
 * Browser end-to-end tests for the web app, against the production build.
 * By default they start a local worker on an empty database (server.mjs);
 * set E2E_BASE_URL (plus E2E_EMAIL / E2E_PASSWORD of an admin) to run them
 * against a deployment instead — they create and delete their own users.
 */
const external = process.env.E2E_BASE_URL;
const port = Number(process.env.E2E_PORT ?? 8798);

export default defineConfig({
  testDir: '.',
  outputDir: '../../test-results/web',
  timeout: 30_000,
  expect: { timeout: 7_000 },
  // One server and one admin account; the specs create users through it.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  reporter: [['list']],
  globalSetup: './global-setup.ts',
  use: {
    baseURL: external ?? `http://127.0.0.1:${port}`,
    // The installed Google Chrome; E2E_CHANNEL=chromium uses Playwright's
    // own build instead (pnpm exec playwright install chromium).
    channel: process.env.E2E_CHANNEL === 'chromium' ? undefined : 'chrome',
    viewport: { width: 1280, height: 800 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: external
    ? undefined
    : {
        command: 'node tests/web/server.mjs',
        cwd: '../..',
        url: `http://127.0.0.1:${port}/`,
        timeout: 120_000,
        reuseExistingServer: false,
        gracefulShutdown: { signal: 'SIGTERM', timeout: 5_000 },
      },
});
