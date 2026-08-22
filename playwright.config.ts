import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';
import 'dotenv/config';

const playwrightSqliteDbPath = process.env.PLAYWRIGHT_SQLITE_DB_PATH?.trim()
  ? path.resolve(process.env.PLAYWRIGHT_SQLITE_DB_PATH)
  : path.resolve(process.cwd(), 'docstore/test-sqlite3.db');
const requestedPlaywrightWorkers = Number.parseInt(
  process.env.PLAYWRIGHT_WORKERS?.trim() ?? '',
  10,
);
const playwrightWorkers =
  Number.isFinite(requestedPlaywrightWorkers) && requestedPlaywrightWorkers > 0
    ? requestedPlaywrightWorkers
    : 2;

process.env.USE_EMBEDDED_WEED_MINI = 'true';
process.env.S3_ACCESS_KEY_ID = 'test';
process.env.S3_SECRET_ACCESS_KEY = 'test';
process.env.S3_ENDPOINT = 'http://127.0.0.1:8335';
process.env.S3_BUCKET = 'openreader';
process.env.SQLITE_DB_PATH = playwrightSqliteDbPath;

/**
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig({
  testDir: './tests',
  testIgnore: '**/unit/**',
  tsconfig: './tsconfig.json',
  timeout: 30 * 1000,
  outputDir: './tests/results',
  // GitHub runners discard their SQLite database and embedded object store.
  // Avoid importing the storage-backed teardown there; it can keep the test
  // process alive after the browser assertions have already finished.
  globalTeardown: process.env.CI ? undefined : './tests/global-teardown.ts',
  // fullyParallel: false,
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // PDF parsing is handled by one embedded compute worker. Keep browser
  // concurrency bounded locally and in CI, while allowing deliberate
  // diagnostic overrides such as PLAYWRIGHT_WORKERS=1.
  workers: playwrightWorkers,
  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter: 'html',
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    /* Base URL to use in actions like `await page.goto('/')`. */
    baseURL: 'http://localhost:3005',

    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: 'retain-on-first-failure',
    screenshot: 'only-on-failure',
  },

  /* Run your local dev server before starting the tests */
  webServer: {
    // Disable auth rate limiting for tests to support parallel workers creating sessions.
    // ENABLE_TEST_NAMESPACE opts the production build into honoring the
    // x-openreader-test-namespace header (ignored on real prod deployments).
    // `exec` replaces Playwright's shell wrapper so its shutdown signal reaches
    // the entrypoint, which then stops Next.js and every embedded test service.
    command: `export BETTER_AUTH_URL=http://localhost:3005 API_KEY=test API_BASE=http://localhost:3005 BASE_URL=http://localhost:3005 USE_ANONYMOUS_AUTH_SESSIONS=true S3_ACCESS_KEY_ID=test S3_SECRET_ACCESS_KEY=test S3_REGION=us-east-1 COMPUTE_WORKER_TOKEN=local-compute-token PORT=3005 S3_ENDPOINT=http://127.0.0.1:8335 EMBEDDED_NATS_PORT=4224 NATS_URL=nats://127.0.0.1:4224 EMBEDDED_NATS_MONITOR_PORT=8224 EMBEDDED_COMPUTE_WORKER_PORT=8083 WEED_MINI_DIR=docstore/test-seaweedfs EMBEDDED_NATS_STORE_DIR=docstore/test-nats SQLITE_DB_PATH="${playwrightSqliteDbPath}" DISABLE_AUTH_RATE_LIMIT=true ENABLE_TEST_NAMESPACE=true && mkdir -p docstore .next/standalone/.next/static .next/standalone/public && cp -R .next/static/. .next/standalone/.next/static/ && cp -R public/. .next/standalone/public/ && exec node scripts/openreader-entrypoint.mjs -- node .next/standalone/server.js`,
    url: 'http://localhost:3005',
    reuseExistingServer: !process.env.CI,
    timeout: 600 * 1000,
    // Playwright defaults to SIGKILL, which bypasses the entrypoint cleanup and
    // leaves its detached Next.js child alive. Allow the entrypoint to stop its
    // embedded services and app process before Playwright escalates.
    gracefulShutdown: { signal: 'SIGTERM', timeout: 15_000 },
    stdout: 'pipe',
    stderr: 'pipe',
  },

  /* Configure projects for major browsers */
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        userAgent: `${devices['Desktop Chrome'].userAgent} OpenReader-Playwright/chromium`,
        extraHTTPHeaders: { 'x-openreader-test-namespace': 'chromium' },
      },
    },

    {
      name: 'firefox',
      testMatch: [
        '**/accessibility.spec.ts',
        '**/landing-routing.spec.ts',
        '**/navigation.spec.ts',
      ],
      use: {
        ...devices['Desktop Firefox'],
        userAgent: `${devices['Desktop Firefox'].userAgent} OpenReader-Playwright/firefox`,
        extraHTTPHeaders: { 'x-openreader-test-namespace': 'firefox' },
      },
    },

    {
      name: 'webkit',
      testMatch: [
        '**/accessibility.spec.ts',
        '**/landing-routing.spec.ts',
        '**/navigation.spec.ts',
      ],
      use: {
        ...devices['Desktop Safari'],
        userAgent: `${devices['Desktop Safari'].userAgent} OpenReader-Playwright/webkit`,
        extraHTTPHeaders: { 'x-openreader-test-namespace': 'webkit' },
      },
    },

    /* Test against mobile viewports. */
    // {
    //   name: 'Mobile Chrome',
    //   use: { ...devices['Pixel 5'] },
    // },
    // {
    //   name: 'Mobile Safari',
    //   use: { ...devices['iPhone 12'] },
    // },

    /* Test against branded browsers. */
    // {
    //   name: 'Microsoft Edge',
    //   use: { ...devices['Desktop Edge'], channel: 'msedge' },
    // },
    // {
    //   name: 'Google Chrome',
    //   use: { ...devices['Desktop Chrome'], channel: 'chrome' },
    // },
  ],
});
