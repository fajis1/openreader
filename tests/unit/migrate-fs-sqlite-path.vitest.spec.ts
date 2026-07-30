import { spawnSync } from 'node:child_process';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, describe, expect, test } from 'vitest';

describe('migrate-fs-v2 SQLite database selection', () => {
  let tempRoot = '';

  afterEach(async () => {
    if (tempRoot) {
      await fsp.rm(tempRoot, { recursive: true, force: true });
    }
  });

  test('uses SQLITE_DB_PATH instead of creating the default database', async () => {
    tempRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'openreader-migrate-fs-'));
    const configuredDbPath = path.join(tempRoot, 'configured', 'test.db');
    const defaultDbPath = path.join(tempRoot, 'docstore', 'sqlite3.db');
    await fsp.mkdir(path.dirname(configuredDbPath), { recursive: true });

    const sqlite = new Database(configuredDbPath);
    sqlite.exec(`
      CREATE TABLE documents (
        id text PRIMARY KEY NOT NULL,
        user_id text NOT NULL,
        file_path text NOT NULL
      );
    `);
    sqlite.close();

    const scriptPath = path.resolve(process.cwd(), 'scripts/migrate-fs-v2.mjs');
    const result = spawnSync(process.execPath, [scriptPath, '--dry-run', 'true'], {
      cwd: tempRoot,
      env: {
        ...process.env,
        SQLITE_DB_PATH: configuredDbPath,
        S3_BUCKET: 'test-bucket',
        S3_REGION: 'us-east-1',
        S3_ACCESS_KEY_ID: 'test',
        S3_SECRET_ACCESS_KEY: 'test',
      },
      encoding: 'utf8',
    });

    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    await expect(fsp.stat(defaultDbPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
