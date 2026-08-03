import { eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { adminSettings } from '@/db/schema';
import {
  normalizeGlobalPronunciationLibrary,
  type GlobalPronunciationLibrary,
} from '@/lib/server/tts/global-pronunciation-library';

type Database = typeof db;

export interface GeneratedGlobalPronunciationMerge {
  generatedLibrary: GlobalPronunciationLibrary;
  libraryAtScanStart: GlobalPronunciationLibrary;
  updatedWords: ReadonlySet<string>;
}

function readLibrary(value: unknown): GlobalPronunciationLibrary {
  try {
    return normalizeGlobalPronunciationLibrary(value || {});
  } catch (error) {
    throw new Error('Cannot safely merge generated pronunciations into the current global library.', {
      cause: error,
    });
  }
}

function applyUnchangedWords(
  latestLibrary: GlobalPronunciationLibrary,
  input: GeneratedGlobalPronunciationMerge,
): string[] {
  const appliedWords: string[] = [];
  for (const word of input.updatedWords) {
    if (
      JSON.stringify(latestLibrary[word] || [])
      === JSON.stringify(input.libraryAtScanStart[word] || [])
    ) {
      latestLibrary[word] = input.generatedLibrary[word];
      appliedWords.push(word);
    }
  }
  return appliedWords;
}

function globalLibraryUpsert(database: Database, library: GlobalPronunciationLibrary) {
  return database.insert(adminSettings).values({
    key: 'global_pronunciations',
    valueJson: JSON.stringify(library),
  }).onConflictDoUpdate({
    target: adminSettings.key,
    set: { valueJson: JSON.stringify(library) },
  });
}

export async function mergeGeneratedGlobalPronunciations(
  input: GeneratedGlobalPronunciationMerge,
  options: { database?: Database; usePostgres?: boolean } = {},
): Promise<string[]> {
  const database = options.database || db;
  const usePostgres = options.usePostgres ?? Boolean(process.env.POSTGRES_URL);
  let appliedWords: string[] = [];

  if (usePostgres) {
    await database.transaction(async (tx: Database) => {
      await tx.execute(sql`
        select pg_advisory_xact_lock(
          hashtextextended('openreader:global_pronunciations', 0)
        )
      `);
      const latestRows = await tx.select({ valueJson: adminSettings.valueJson })
        .from(adminSettings)
        .where(eq(adminSettings.key, 'global_pronunciations'))
        .limit(1);
      const latestLibrary = readLibrary(latestRows[0]?.valueJson);
      appliedWords = applyUnchangedWords(latestLibrary, input);
      if (appliedWords.length > 0) await globalLibraryUpsert(tx, latestLibrary);
    });
    return appliedWords;
  }

  // Drizzle's better-sqlite3 transaction callback must remain synchronous.
  database.transaction((tx: Database) => {
    const latestRows = tx.select({ valueJson: adminSettings.valueJson })
      .from(adminSettings)
      .where(eq(adminSettings.key, 'global_pronunciations'))
      .limit(1)
      .all();
    const latestLibrary = readLibrary(latestRows[0]?.valueJson);
    appliedWords = applyUnchangedWords(latestLibrary, input);
    if (appliedWords.length > 0) globalLibraryUpsert(tx, latestLibrary).run();
  });
  return appliedWords;
}
