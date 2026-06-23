import { defineConfig, devices } from '@playwright/test';
import 'dotenv/config';

process.env.USE_EMBEDDED_WEED_MINI = 'true';
process.env.S3_ACCESS_KEY_ID = 'test';
process.env.S3_SECRET_ACCESS_KEY = 'test';
process.env.S3_ENDPOINT = 'http://127.0.0.1:8335';
process.env.S3_BUCKET = 'openreader';

/**
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig({
  testDir: './tests',
  testIgnore: '**/unit/**',
  tsconfig: './tsconfig.json',
  timeout: 30 * 1000,
  outputDir: './tests/results',
  globalTeardown: './tests/global-teardown.ts',
  // fullyParallel: false,
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  // workers: '50%',
  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter: 'html',
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    /* Base URL to use in actions like `await page.goto('/')`. */
    baseURL: 'http://127.0.0.1:3005',

    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: 'retain-on-first-failure',
    screenshot: 'only-on-failure',
  },

  /* Run your local dev server before starting the tests */
  webServer: {
    // Disable auth rate limiting for tests to support parallel workers creating sessions.
    // ENABLE_TEST_NAMESPACE opts the production build into honoring the
    // x-openreader-test-namespace header (ignored on real prod deployments).
    command: `export BETTER_AUTH_URL=http://127.0.0.1:3005 API_KEY=test API_BASE=http://127.0.0.1:3005 BASE_URL=http://127.0.0.1:3005 USE_ANONYMOUS_AUTH_SESSIONS=true S3_ACCESS_KEY_ID=test S3_SECRET_ACCESS_KEY=test COMPUTE_WORKER_TOKEN=local-compute-token PORT=3005 S3_ENDPOINT=http://127.0.0.1:8335 EMBEDDED_NATS_PORT=4224 NATS_URL=nats://127.0.0.1:4224 EMBEDDED_NATS_MONITOR_PORT=8224 EMBEDDED_COMPUTE_WORKER_PORT=8083 WEED_MINI_DIR=docstore/test-seaweedfs EMBEDDED_NATS_STORE_DIR=docstore/test-nats SQLITE_DB_PATH=docstore/test-sqlite3.db DISABLE_AUTH_RATE_LIMIT=true ENABLE_TEST_NAMESPACE=true && pnpm migrate && pnpm build && node scripts/openreader-entrypoint.mjs -- next start -p 3005 > /tmp/webserver.log 2>&1`,
    url: 'http://127.0.0.1:3005',
    reuseExistingServer: true,
    timeout: 240 * 1000,
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
      use: {
        ...devices['Desktop Firefox'],
        userAgent: `${devices['Desktop Firefox'].userAgent} OpenReader-Playwright/firefox`,
        extraHTTPHeaders: { 'x-openreader-test-namespace': 'firefox' },
      },
    },

    {
      name: 'webkit',
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
