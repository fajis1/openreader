import { defineConfig, devices } from '@playwright/test';
import 'dotenv/config';

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
    baseURL: 'http://localhost:3003',

    /* Collect trace when retrying the failed test. See https://playwright.dev/docs/trace-viewer */
    trace: 'retain-on-first-failure',
    screenshot: 'only-on-failure',
  },

  /* Run your local dev server before starting the tests */
  webServer: {
    // Disable auth rate limiting for tests to support parallel workers creating sessions.
    // ENABLE_TEST_NAMESPACE opts the production build into honoring the
    // x-openreader-test-namespace header (ignored on real prod deployments).
    command: `BASE_URL=http://localhost:3003 USE_ANONYMOUS_AUTH_SESSIONS=true pnpm build && (S3_ACCESS_KEY_ID=test S3_SECRET_ACCESS_KEY=test COMPUTE_WORKER_TOKEN=local-compute-token pnpm --filter @openreader/compute-worker start & S3_ACCESS_KEY_ID=test S3_SECRET_ACCESS_KEY=test COMPUTE_WORKER_TOKEN=local-compute-token BASE_URL=http://localhost:3003 DISABLE_AUTH_RATE_LIMIT=true ENABLE_TEST_NAMESPACE=true USE_ANONYMOUS_AUTH_SESSIONS=true pnpm start)`,
    url: 'http://localhost:3003',
    reuseExistingServer: !process.env.CI,
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
