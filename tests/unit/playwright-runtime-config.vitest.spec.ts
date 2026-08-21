import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';

describe('Playwright standalone runtime configuration', () => {
  const source = readFileSync(
    path.resolve(process.cwd(), 'playwright.config.ts'),
    'utf8',
  );
  const workflow = readFileSync(
    path.resolve(process.cwd(), '.github/workflows/playwright.yml'),
    'utf8',
  );
  const helpers = readFileSync(
    path.resolve(process.cwd(), 'tests/helpers.ts'),
    'utf8',
  );
  const exportTests = readFileSync(
    path.resolve(process.cwd(), 'tests/export.spec.ts'),
    'utf8',
  );

  test('shares one absolute SQLite path with migrations, the server, and teardown', () => {
    expect(source).toContain('process.env.PLAYWRIGHT_SQLITE_DB_PATH?.trim()');
    expect(source).toContain("path.resolve(process.cwd(), 'docstore/test-sqlite3.db')");
    expect(source).toContain('process.env.SQLITE_DB_PATH = playwrightSqliteDbPath');
    expect(source).toContain('SQLITE_DB_PATH="${playwrightSqliteDbPath}"');
  });

  test('copies standalone assets and keeps web-server errors visible', () => {
    expect(source).toContain(
      'cp -R .next/static/. .next/standalone/.next/static/',
    );
    expect(source).toContain('cp -R public/. .next/standalone/public/');
    expect(source).not.toContain('/tmp/webserver.log');
  });

  test('bounds concurrency to the embedded compute worker capacity', () => {
    expect(source).toContain('process.env.PLAYWRIGHT_WORKERS?.trim()');
    expect(source).toContain(': 2;');
    expect(source).toContain('workers: playwrightWorkers');
  });

  test('does not reuse a stale web server in CI', () => {
    expect(source).toContain('reuseExistingServer: !process.env.CI');
  });

  test('prepares cached PP-DocLayout assets before parallel browser tests', () => {
    expect(workflow).toContain('uses: actions/cache@v5');
    expect(workflow).toContain('path: docstore/model');
    expect(workflow).toContain("hashFiles('compute/core/src/pdf/assets/manifest.json')");
    expect(workflow).toContain('pnpm exec tsx scripts/prepare-pdf-layout-model.ts');
    expect(workflow.indexOf('Prepare PP-DocLayout model')).toBeLessThan(
      workflow.indexOf('Run Playwright tests'),
    );
  });

  test('lets cold-start-aware tests pass their timeout into PDF readiness polling', () => {
    expect(helpers).toContain('options: { pdfReadyTimeoutMs?: number } = {}');
    expect(helpers).toContain('waitForPdfViewerReady(page, options.pdfReadyTimeoutMs)');
    expect(exportTests).toContain('pdfReadyTimeoutMs: testInfo.timeout - 10_000');
    expect(exportTests).toContain('test.setTimeout(180_000)');
  });
});
