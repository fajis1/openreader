import { NextResponse, NextRequest } from 'next/server';
import { db } from '@/db';
import { adminSettings } from '@/db/schema';
import { eq, sql } from 'drizzle-orm';
import { requireAdminContext } from '@/lib/server/auth/admin';
import {
  normalizeGlobalPronunciationLibrary,
  recordLearnedGlobalPronunciation,
  replaceGlobalPronunciationChoices,
  setGlobalPronunciationDefault,
  type GlobalPronunciationLibrary,
} from '@/lib/server/tts/global-pronunciation-library';
import { errorResponse } from '@/lib/server/errors/next-response';
import { serverLogger } from '@/lib/server/logger';

const DEFAULT_SEED_PRONUNCIATIONS: Record<string, string[]> = {
  "Eather": ["/iːθər/"],
  "Yin Lime": ["/jɪn laɪm/"],
  "Eatheral": ["/iːθərəl/"],
  "Aetherian": ["/iːθərɪən/"],
  "stumbled": ["/stʌmbəld/"],
  "bottomed-out": ["/bɒtəmd aʊt/"],
  "launched": ["/lɔːntʃt/"],
  "face-planted": ["/feɪs plæntəd/"],
  "Aetherians": ["/iːθərɪən/"],
  "Avinian": ["/əvɪniən/"],
  "qŏdāšîm": ["/koʊdɑʃim/"],
  "qādôš": ["/kɑdoʊʃ/"],
  "λόγος": ["/lɒɡɒs/"],
  "καταλλάσσω": ["/kɑtɑlɑsoʊ/"],
  "בְּרִית": ["/bəɹiθ/"]
};

type GlobalLibraryMutationResult<T> = {
  result: T;
  changed: boolean;
};

async function mutateGlobalPronunciationLibrary<T>(
  mutation: (library: GlobalPronunciationLibrary) => GlobalLibraryMutationResult<T>,
): Promise<T> {
  let mutationResult = { result: undefined as T, changed: false };
  let completed = false;
  if (process.env.POSTGRES_URL) {
    await db.transaction(async (tx: typeof db) => {
      await tx.execute(sql`
        select pg_advisory_xact_lock(
          hashtextextended('openreader:global_pronunciations', 0)
        )
      `);
      const latestRows = await tx
        .select({ valueJson: adminSettings.valueJson })
        .from(adminSettings)
        .where(eq(adminSettings.key, 'global_pronunciations'))
        .limit(1);
      const latestLibrary = normalizeGlobalPronunciationLibrary(latestRows[0]?.valueJson || {});
      mutationResult = mutation(latestLibrary);
      completed = true;
      if (!mutationResult.changed) return;
      await tx.insert(adminSettings).values({
        key: 'global_pronunciations',
        valueJson: JSON.stringify(latestLibrary),
      }).onConflictDoUpdate({
        target: adminSettings.key,
        set: { valueJson: JSON.stringify(latestLibrary) },
      });
    });
  } else {
    db.transaction((tx: typeof db) => {
      const latestRows = tx
        .select({ valueJson: adminSettings.valueJson })
        .from(adminSettings)
        .where(eq(adminSettings.key, 'global_pronunciations'))
        .limit(1);
      const latestLibrary = normalizeGlobalPronunciationLibrary(latestRows[0]?.valueJson || {});
      mutationResult = mutation(latestLibrary);
      completed = true;
      if (!mutationResult.changed) return;
      tx.insert(adminSettings).values({
        key: 'global_pronunciations',
        valueJson: JSON.stringify(latestLibrary),
      }).onConflictDoUpdate({
        target: adminSettings.key,
        set: { valueJson: JSON.stringify(latestLibrary) },
      });
    });
  }
  if (!completed) throw new Error('Global pronunciation transaction did not complete.');
  return mutationResult.result;
}

export async function GET() {
  try {
    const rows = await db
      .select({ valueJson: adminSettings.valueJson })
      .from(adminSettings)
      .where(eq(adminSettings.key, 'global_pronunciations'))
      .limit(1);

    let parsed: unknown = {};
    if (!rows || rows.length === 0 || !rows[0].valueJson) {
      // Seed initial global dictionary with default prepopulated pronunciations
      parsed = DEFAULT_SEED_PRONUNCIATIONS;
      await db.insert(adminSettings).values({
        key: 'global_pronunciations',
        valueJson: JSON.stringify(DEFAULT_SEED_PRONUNCIATIONS)
      }).onConflictDoUpdate({
        target: adminSettings.key,
        set: { valueJson: JSON.stringify(DEFAULT_SEED_PRONUNCIATIONS) }
      });
    } else {
      const value = rows[0].valueJson;
      parsed = typeof value === 'string' ? JSON.parse(value) : value;
      if (!parsed || Object.keys(parsed).length === 0) {
        parsed = DEFAULT_SEED_PRONUNCIATIONS;
      }
    }

    return NextResponse.json(normalizeGlobalPronunciationLibrary(parsed));
  } catch (error) {
    serverLogger.error({ event: 'tts.global_pronunciations.read.failed', error }, 'Failed to get global pronunciations');
    return NextResponse.json({});
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as Record<string, unknown>;
    const word = typeof body.word === 'string' ? body.word.trim() : '';
    const phonetic = typeof body.phonetic === 'string' ? body.phonetic : '';
    if (!word || !phonetic) {
      if (body.action !== 'replace-choices' || !word || !Array.isArray(body.choices)) {
        return NextResponse.json({ error: 'Missing word or phonetic' }, { status: 400 });
      }
    }

    if (body.action === 'set-default' || body.action === 'replace-choices') {
      const admin = await requireAdminContext(req);
      if (admin instanceof Response) return admin;

      const buildUpdatedList = (latestLibrary: GlobalPronunciationLibrary) => (
        body.action === 'set-default'
          ? setGlobalPronunciationDefault(latestLibrary, word, phonetic)
          : replaceGlobalPronunciationChoices(word, body.choices, body.defaultIndex)
      );
      const updatedList = await mutateGlobalPronunciationLibrary((latestLibrary) => {
        const next = buildUpdatedList(latestLibrary);
        if (next) latestLibrary[word] = next;
        return { result: next, changed: next !== null };
      });
      if (!updatedList) {
        return NextResponse.json({
          error: 'All global pronunciations must be valid, safe slash-delimited Kokoro IPA values.',
        }, { status: 400 });
      }
      return NextResponse.json({ success: true, updatedList });
    }

    const updatedList = await mutateGlobalPronunciationLibrary((currentGlobal) => {
      const existingList = currentGlobal[word] || [];
      const learnedList = recordLearnedGlobalPronunciation(existingList, phonetic);
      currentGlobal[word] = learnedList;
      return { result: learnedList, changed: learnedList !== existingList };
    });

    return NextResponse.json({ success: true, updatedList });
  } catch (error) {
    return errorResponse(error, {
      logger: serverLogger,
      event: 'tts.global_pronunciations.update.failed',
      msg: 'Failed to update global pronunciations',
      apiErrorMessage: 'Failed to update global pronunciations.',
    });
  }
}
