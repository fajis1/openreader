import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';

describe('Playwright standalone runtime configuration', () => {
  const source = readFileSync(
    path.resolve(process.cwd(), 'playwright.config.ts'),
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
});
