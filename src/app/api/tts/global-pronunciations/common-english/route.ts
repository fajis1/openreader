import { NextRequest, NextResponse } from 'next/server';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { adminSettings, documentSettings } from '@/db/schema';
import { requireAdminContext } from '@/lib/server/auth/admin';
import { classifyCommonEnglishWords } from '@/lib/server/tts/common-english-classifier';
import {
  isMachineGeneratedGlobalPronunciationChoice,
  normalizeGlobalPronunciationLibrary,
} from '@/lib/server/tts/global-pronunciation-library';
import { normalizeGlobalDefinitions } from '@/lib/server/smart-audio/global-definition-library';
import { serverLogger } from '@/lib/server/logger';
import { errorResponse } from '@/lib/server/errors/next-response';

const GLOBAL_PRONUNCIATIONS_KEY = 'global_pronunciations';
const GLOBAL_DEFINITIONS_KEY = 'global_definitions';
const MAX_REMOVALS = 1000;

async function loadCandidates() {
  const rows = await db.select({ valueJson: adminSettings.valueJson })
    .from(adminSettings)
    .where(eq(adminSettings.key, GLOBAL_PRONUNCIATIONS_KEY))
    .limit(1);
  const library = normalizeGlobalPronunciationLibrary(rows[0]?.valueJson || {});
  const eligibleWords = Object.entries(library)
    .filter(([, choices]) => choices.some(isMachineGeneratedGlobalPronunciationChoice))
    .map(([word]) => word);
  const matches = await classifyCommonEnglishWords(eligibleWords);
  return matches.map((match) => {
    const choices = library[match.word] || [];
    const removable = choices.length > 0 && choices.every(isMachineGeneratedGlobalPronunciationChoice);
    return {
      ...match,
      choices: choices.map((choice) => choice.phonetic),
      removable,
      protectedChoices: choices.filter((choice) => !isMachineGeneratedGlobalPronunciationChoice(choice)).length,
    };
  }).sort((a, b) => b.zipfFrequency - a.zipfFrequency || a.word.localeCompare(b.word));
}

async function removeGlobalWords(requestedWords: Set<string>): Promise<string[]> {
  let removed: string[] = [];
  const mutate = (raw: unknown) => {
    const library = normalizeGlobalPronunciationLibrary(raw || {});
    removed = [];
    for (const word of requestedWords) {
      const choices = library[word] || [];
      if (choices.length > 0 && choices.every(isMachineGeneratedGlobalPronunciationChoice)) {
        delete library[word];
        removed.push(word);
      }
    }
    return library;
  };

  if (process.env.POSTGRES_URL) {
    await db.transaction(async (tx: typeof db) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended('openreader:global_pronunciations', 0))`);
      const rows = await tx.select({ valueJson: adminSettings.valueJson })
        .from(adminSettings).where(eq(adminSettings.key, GLOBAL_PRONUNCIATIONS_KEY)).limit(1);
      const library = mutate(rows[0]?.valueJson);
      if (removed.length > 0) {
        await tx.insert(adminSettings).values({
          key: GLOBAL_PRONUNCIATIONS_KEY,
          valueJson: JSON.stringify(library),
        }).onConflictDoUpdate({
          target: adminSettings.key,
          set: { valueJson: JSON.stringify(library) },
        });
      }
    });
  } else {
    db.transaction((tx: typeof db) => {
      const rows = tx.select({ valueJson: adminSettings.valueJson })
        .from(adminSettings).where(eq(adminSettings.key, GLOBAL_PRONUNCIATIONS_KEY)).limit(1).all();
      const library = mutate(rows[0]?.valueJson);
      if (removed.length > 0) {
        tx.insert(adminSettings).values({
          key: GLOBAL_PRONUNCIATIONS_KEY,
          valueJson: JSON.stringify(library),
        }).onConflictDoUpdate({
          target: adminSettings.key,
          set: { valueJson: JSON.stringify(library) },
        }).run();
      }
    });
  }
  return removed;
}

async function removeLinkedEntries(words: readonly string[]) {
  if (words.length === 0) return { definitionsRemoved: 0, bookLexiconEntriesRemoved: 0, booksUpdated: 0 };
  const selected = new Set(words);
  let definitionsRemoved = 0;
  const definitionRows = await db.select({ valueJson: adminSettings.valueJson })
    .from(adminSettings).where(eq(adminSettings.key, GLOBAL_DEFINITIONS_KEY)).limit(1);
  const definitions = normalizeGlobalDefinitions(definitionRows[0]?.valueJson || {});
  for (const word of selected) {
    if (Object.prototype.hasOwnProperty.call(definitions, word)) {
      delete definitions[word];
      definitionsRemoved += 1;
    }
  }
  if (definitionsRemoved > 0) {
    await db.insert(adminSettings).values({
      key: GLOBAL_DEFINITIONS_KEY,
      valueJson: JSON.stringify(definitions),
    }).onConflictDoUpdate({
      target: adminSettings.key,
      set: { valueJson: JSON.stringify(definitions) },
    });
  }

  const settingsRows = await db.select({
    userId: documentSettings.userId,
    documentId: documentSettings.documentId,
    dataJson: documentSettings.dataJson,
  }).from(documentSettings);
  let bookLexiconEntriesRemoved = 0;
  let booksUpdated = 0;
  for (const row of settingsRows) {
    let settings: Record<string, unknown>;
    try {
      settings = (typeof row.dataJson === 'string' ? JSON.parse(row.dataJson) : row.dataJson) as Record<string, unknown>;
    } catch {
      continue;
    }
    const lexicon = settings?.smartAudioLexicon as { entries?: Record<string, unknown> } | undefined;
    if (!lexicon?.entries) continue;
    let changed = false;
    for (const word of selected) {
      if (Object.prototype.hasOwnProperty.call(lexicon.entries, word)) {
        delete lexicon.entries[word];
        bookLexiconEntriesRemoved += 1;
        changed = true;
      }
    }
    if (!changed) continue;
    booksUpdated += 1;
    const serialized = process.env.POSTGRES_URL ? settings : JSON.stringify(settings);
    await db.update(documentSettings).set({ dataJson: serialized as never, updatedAt: Date.now() })
      .where(and(
        eq(documentSettings.userId, row.userId),
        eq(documentSettings.documentId, row.documentId),
      ));
  }
  return { definitionsRemoved, bookLexiconEntriesRemoved, booksUpdated };
}

export async function POST(request: NextRequest) {
  try {
    const admin = await requireAdminContext(request);
    if (admin instanceof Response) return admin;
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    if (body.action === 'scan') {
      return NextResponse.json({ candidates: await loadCandidates() });
    }
    if (body.action !== 'remove' || !Array.isArray(body.words)) {
      return NextResponse.json({ error: 'Use action "scan" or provide words for action "remove".' }, { status: 400 });
    }
    const requested = [...new Set(body.words.filter((word): word is string => typeof word === 'string' && Boolean(word.trim())))];
    if (requested.length === 0 || requested.length > MAX_REMOVALS) {
      return NextResponse.json({ error: `Select between 1 and ${MAX_REMOVALS} words.` }, { status: 400 });
    }

    // Reclassify on removal so a stale or forged preview cannot delete fantasy terms.
    const common = new Set((await classifyCommonEnglishWords(requested)).map((match) => match.word));
    const removedWords = await removeGlobalWords(new Set(requested.filter((word) => common.has(word))));
    const linked = await removeLinkedEntries(removedWords);
    serverLogger.info({
      event: 'tts.global_pronunciations.common_english_removed',
      adminUserId: admin.userId,
      wordsRemoved: removedWords.length,
      ...linked,
    }, 'Removed administrator-approved machine-generated common English dictionary entries');
    return NextResponse.json({ removedWords, ...linked });
  } catch (error) {
    serverLogger.error({ event: 'tts.global_pronunciations.common_english.failed', error }, 'Common-English dictionary cleanup failed');
    return errorResponse(error, { apiErrorMessage: 'Common-English dictionary cleanup failed.' });
  }
}
