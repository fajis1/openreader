import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, test } from 'vitest';
import * as sqliteSchema from '../../src/db/schema_sqlite';
import { mergeGeneratedGlobalPronunciations } from '../../src/lib/server/smart-audio/global-pronunciation-merge';
import type { GlobalPronunciationLibrary } from '../../src/lib/server/tts/global-pronunciation-library';

let sqlite: Database.Database;
let database: ReturnType<typeof drizzle>;

function choices(phonetic: string) {
  return [{ phonetic, usageCount: 0 }];
}

function readLibrary(): GlobalPronunciationLibrary {
  const row = database.select({ valueJson: sqliteSchema.adminSettings.valueJson })
    .from(sqliteSchema.adminSettings)
    .where(eq(sqliteSchema.adminSettings.key, 'global_pronunciations'))
    .limit(1)
    .all()[0];
  return JSON.parse(String(row?.valueJson || '{}'));
}

beforeEach(() => {
  sqlite = new Database(':memory:');
  sqlite.exec(`CREATE TABLE admin_settings (
    key text PRIMARY KEY NOT NULL,
    value_json text NOT NULL,
    source text NOT NULL DEFAULT 'admin',
    updated_at integer NOT NULL DEFAULT 0
  );`);
  database = drizzle(sqlite, { schema: sqliteSchema });
});

describe('SQLite generated global-pronunciation merge', () => {
  test('uses a synchronous transaction and writes into an empty library', async () => {
    await expect(mergeGeneratedGlobalPronunciations({
      generatedLibrary: { λόγος: choices('/loʊɡɒs/') },
      libraryAtScanStart: {},
      updatedWords: new Set(['λόγος']),
    }, { database, usePostgres: false })).resolves.toEqual(['λόγος']);

    expect(readLibrary()).toEqual({ λόγος: choices('/loʊɡɒs/') });
  });

  test('merges new words without replacing concurrent changes', async () => {
    const original = { λόγος: choices('/old/') };
    database.insert(sqliteSchema.adminSettings).values({
      key: 'global_pronunciations',
      valueJson: JSON.stringify({ ...original, חֶסֶד: choices('/existing/') }),
    }).run();

    const applied = await mergeGeneratedGlobalPronunciations({
      generatedLibrary: {
        λόγος: choices('/generated/'),
        στοιχεῖα: choices('/stɔɪxeɪa/'),
      },
      libraryAtScanStart: original,
      updatedWords: new Set(['λόγος', 'στοιχεῖα']),
    }, { database, usePostgres: false });

    expect(applied).toEqual(['λόγος', 'στοιχεῖα']);
    expect(readLibrary()).toEqual({
      λόγος: choices('/generated/'),
      חֶסֶד: choices('/existing/'),
      στοιχεῖα: choices('/stɔɪxeɪa/'),
    });

    database.update(sqliteSchema.adminSettings).set({
      valueJson: JSON.stringify({ ...readLibrary(), λόγος: choices('/admin-change/') }),
    }).where(eq(sqliteSchema.adminSettings.key, 'global_pronunciations')).run();
    expect(await mergeGeneratedGlobalPronunciations({
      generatedLibrary: { λόγος: choices('/second-generated/') },
      libraryAtScanStart: { λόγος: choices('/generated/') },
      updatedWords: new Set(['λόγος']),
    }, { database, usePostgres: false })).toEqual([]);
    expect(readLibrary().λόγος).toEqual(choices('/admin-change/'));
  });

  test('rolls back when the merged library cannot be serialized', async () => {
    const circular: Record<string, unknown> = { phonetic: '/circular/' };
    circular.self = circular;
    await expect(mergeGeneratedGlobalPronunciations({
      generatedLibrary: {
        λόγος: [circular] as never,
      },
      libraryAtScanStart: {},
      updatedWords: new Set(['λόγος']),
    }, { database, usePostgres: false })).rejects.toThrow('circular');
    expect(readLibrary()).toEqual({});
  });
});
