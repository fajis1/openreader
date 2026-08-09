import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

import { eq, sql } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';

import { db } from '@/db';
import { adminSettings } from '@/db/schema';
import { requireAuthContext } from '@/lib/server/auth/auth';
import {
  readSmartAudioProfilesDocument,
  writeSmartAudioProfilesDocument,
} from '@/lib/server/smart-audio-profiles';
import {
  previewGlobalDefinitionImport,
} from '@/lib/server/smart-audio/global-definition-library';
import { errorResponse } from '@/lib/server/errors/next-response';
import { serverLogger } from '@/lib/server/logger';
import {
  previewGlobalPronunciationImport,
} from '@/lib/server/tts/global-pronunciation-library';
import {
  applyDictionaryReleaseToGlobal,
  applyDictionaryReleaseToProfile,
  buildDictionaryReleaseUpdates,
  parseDictionaryReleaseTombstones,
  type DictionaryReleaseUpdate,
} from '@/lib/server/tts/dictionary-release';

export const dynamic = 'force-dynamic';

const PRONUNCIATION_FILE = path.join(process.cwd(), 'src/lib/server/default_global_pronunciations.json');
const DEFINITION_FILE = path.join(process.cwd(), 'src/lib/server/default_global_definitions.json');
const TOMBSTONE_FILE = path.join(process.cwd(), 'src/lib/server/default_global_pronunciation_tombstones.json');

type Database = typeof db;

async function safeReadFile(filePath: string, fallback = '{}'): Promise<string> {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch {
    return fallback;
  }
}

async function readDictionaryRelease() {
  const [pronunciationRaw, definitionRaw, tombstoneRaw] = await Promise.all([
    safeReadFile(PRONUNCIATION_FILE),
    safeReadFile(DEFINITION_FILE),
    safeReadFile(TOMBSTONE_FILE, '{"version":1,"generatedAt":null,"entries":{}}'),
  ]);
  const pronunciationSource: unknown = JSON.parse(pronunciationRaw || '{}');
  const definitionSource: unknown = JSON.parse(definitionRaw || '{}');
  const tombstoneSource: unknown = JSON.parse(tombstoneRaw || '{}');
  const pronunciationPreview = previewGlobalPronunciationImport(pronunciationSource);
  const definitionPreview = previewGlobalDefinitionImport(definitionSource);
  const sourceWordCount = pronunciationSource && typeof pronunciationSource === 'object'
    && !Array.isArray(pronunciationSource)
    ? Object.keys(pronunciationSource).length
    : 0;
  const sourceDefinitionCount = definitionSource && typeof definitionSource === 'object'
    && !Array.isArray(definitionSource)
    ? Object.keys(definitionSource).length
    : 0;
  if (
    pronunciationPreview.issues.length > 0
    || pronunciationPreview.validWords !== sourceWordCount
    || definitionPreview.issues.length > 0
    || definitionPreview.validDefinitions !== sourceDefinitionCount
  ) {
    throw new Error('The bundled dictionary release failed validation.');
  }
  const tombstones = parseDictionaryReleaseTombstones(tombstoneSource);
  const hash = crypto.createHash('sha256')
    .update(pronunciationRaw)
    .update(definitionRaw)
    .update(tombstoneRaw)
    .digest('hex');
  return {
    hash,
    pronunciations: pronunciationPreview.library,
    definitions: definitionPreview.definitions,
    tombstones,
  };
}

function parseSetting(value: unknown): unknown {
  if (typeof value !== 'string') return value || {};
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}

function selectedWordSet(value: unknown): Set<string> {
  if (!Array.isArray(value)) return new Set();
  return new Set(value
    .filter((word): word is string => typeof word === 'string')
    .map((word) => word.trim())
    .filter(Boolean)
    .slice(0, 10_000));
}

function availableWords(
  updates: DictionaryReleaseUpdate[],
  type: DictionaryReleaseUpdate['type'],
): Set<string> {
  return new Set(updates.filter((update) => update.type === type).map((update) => update.word));
}

function intersect(selected: ReadonlySet<string>, available: ReadonlySet<string>): Set<string> {
  return new Set([...selected].filter((word) => available.has(word)));
}

function upsertSetting(database: Database, key: string, value: unknown) {
  return database.insert(adminSettings).values({
    key,
    valueJson: JSON.stringify(value),
    source: key === 'resolved_dictionary_hash' ? 'system' : 'admin',
  }).onConflictDoUpdate({
    target: adminSettings.key,
    set: { valueJson: JSON.stringify(value) },
  });
}

async function saveResolvedHashForAdmin(hash: string): Promise<void> {
  if (process.env.POSTGRES_URL) {
    await upsertSetting(db, 'resolved_dictionary_hash', hash);
  } else {
    upsertSetting(db, 'resolved_dictionary_hash', hash).run();
  }
}

async function applyAdminRelease(input: {
  release: Awaited<ReturnType<typeof readDictionaryRelease>>;
  selectedPronunciationWords: Set<string>;
  selectedDefinitionWords: Set<string>;
  selectedPronunciationRemovals: Set<string>;
  selectedDefinitionRemovals: Set<string>;
  dismissAll: boolean;
}): Promise<void> {
  const applyLatest = (pronunciationValue: unknown, definitionValue: unknown) => {
    const currentPronunciations = parseSetting(pronunciationValue);
    const currentDefinitions = parseSetting(definitionValue);
    const updates = buildDictionaryReleaseUpdates({
      gitPronunciations: input.release.pronunciations,
      gitDefinitions: input.release.definitions,
      tombstones: input.release.tombstones,
      globalPronunciations: currentPronunciations,
      globalDefinitions: currentDefinitions,
      isAdmin: true,
    });
    return applyDictionaryReleaseToGlobal({
      currentPronunciations,
      currentDefinitions,
      gitPronunciations: input.release.pronunciations,
      gitDefinitions: input.release.definitions,
      tombstones: input.release.tombstones,
      selectedPronunciationWords: intersect(
        input.selectedPronunciationWords,
        availableWords(updates, 'pronunciation'),
      ),
      selectedDefinitionWords: intersect(
        input.selectedDefinitionWords,
        availableWords(updates, 'definition'),
      ),
      selectedPronunciationRemovals: intersect(
        input.selectedPronunciationRemovals,
        availableWords(updates, 'pronunciation-removal'),
      ),
      selectedDefinitionRemovals: intersect(
        input.selectedDefinitionRemovals,
        availableWords(updates, 'definition-removal'),
      ),
    });
  };

  if (process.env.POSTGRES_URL) {
    await db.transaction(async (tx: Database) => {
      await tx.execute(sql`
        select pg_advisory_xact_lock(
          hashtextextended('openreader:dictionary-release', 0)
        )
      `);
      const pronunciationRows = await tx.select({ valueJson: adminSettings.valueJson })
        .from(adminSettings)
        .where(eq(adminSettings.key, 'global_pronunciations'))
        .limit(1);
      const definitionRows = await tx.select({ valueJson: adminSettings.valueJson })
        .from(adminSettings)
        .where(eq(adminSettings.key, 'global_definitions'))
        .limit(1);
      if (!input.dismissAll) {
        const applied = applyLatest(
          pronunciationRows[0]?.valueJson,
          definitionRows[0]?.valueJson,
        );
        await upsertSetting(tx, 'global_pronunciations', applied.pronunciations);
        await upsertSetting(tx, 'global_definitions', applied.definitions);
      }
      await upsertSetting(tx, 'resolved_dictionary_hash', input.release.hash);
    });
    return;
  }

  db.transaction((tx: Database) => {
    const pronunciationRows = tx.select({ valueJson: adminSettings.valueJson })
      .from(adminSettings)
      .where(eq(adminSettings.key, 'global_pronunciations'))
      .limit(1)
      .all();
    const definitionRows = tx.select({ valueJson: adminSettings.valueJson })
      .from(adminSettings)
      .where(eq(adminSettings.key, 'global_definitions'))
      .limit(1)
      .all();
    if (!input.dismissAll) {
      const applied = applyLatest(
        pronunciationRows[0]?.valueJson,
        definitionRows[0]?.valueJson,
      );
      upsertSetting(tx, 'global_pronunciations', applied.pronunciations).run();
      upsertSetting(tx, 'global_definitions', applied.definitions).run();
    }
    upsertSetting(tx, 'resolved_dictionary_hash', input.release.hash).run();
  });
}

export async function GET(request: NextRequest) {
  try {
    const context = await requireAuthContext(request);
    if (context instanceof Response) return context;

    const release = await readDictionaryRelease();
    const isAdmin = context.user?.isAdmin === true;
    const profilesDocument = await readSmartAudioProfilesDocument(context.userId);
    const activeProfile = profilesDocument.profiles.find(
      (profile) => profile.id === profilesDocument.selectedProfileId,
    ) || profilesDocument.profiles[0];
    const pronunciationRows = await db.select({ valueJson: adminSettings.valueJson })
      .from(adminSettings)
      .where(eq(adminSettings.key, 'global_pronunciations'))
      .limit(1);
    const definitionRows = await db.select({ valueJson: adminSettings.valueJson })
      .from(adminSettings)
      .where(eq(adminSettings.key, 'global_definitions'))
      .limit(1);

    if (isAdmin) {
      const hashRows = await db.select({ valueJson: adminSettings.valueJson })
        .from(adminSettings)
        .where(eq(adminSettings.key, 'resolved_dictionary_hash'))
        .limit(1);
      if (parseSetting(hashRows[0]?.valueJson) === release.hash) {
        return NextResponse.json({ hasUpdates: false });
      }
    } else if (activeProfile?.resolvedDictionaryHash === release.hash) {
      return NextResponse.json({ hasUpdates: false });
    }

    const updates = buildDictionaryReleaseUpdates({
      gitPronunciations: release.pronunciations,
      gitDefinitions: release.definitions,
      tombstones: release.tombstones,
      globalPronunciations: parseSetting(pronunciationRows[0]?.valueJson),
      globalDefinitions: parseSetting(definitionRows[0]?.valueJson),
      activeProfile,
      isAdmin,
    });
    if (updates.length === 0) {
      if (isAdmin) {
        await saveResolvedHashForAdmin(release.hash);
      } else if (activeProfile) {
        activeProfile.resolvedDictionaryHash = release.hash;
        await writeSmartAudioProfilesDocument(context.userId, profilesDocument);
      }
      return NextResponse.json({ hasUpdates: false });
    }

    return NextResponse.json({
      hasUpdates: true,
      hash: release.hash,
      isAdmin,
      updates,
    });
  } catch (error) {
    return errorResponse(error, {
      logger: serverLogger,
      event: 'tts.dictionary_release.compare.failed',
      msg: 'Failed to compare bundled dictionary release',
      apiErrorMessage: 'Failed to compare dictionary updates.',
    });
  }
}

export async function POST(request: NextRequest) {
  try {
    const context = await requireAuthContext(request);
    if (context instanceof Response) return context;
    const body = await request.json() as Record<string, unknown>;
    const release = await readDictionaryRelease();
    if (body.hash !== release.hash) {
      return NextResponse.json(
        { error: 'The bundled dictionary changed. Review the latest update before applying it.' },
        { status: 409 },
      );
    }

    const selectedPronunciationWords = selectedWordSet(body.selectedPronunciationWords);
    const selectedDefinitionWords = selectedWordSet(body.selectedDefinitionWords);
    const selectedPronunciationRemovals = selectedWordSet(body.selectedPronunciationRemovals);
    const selectedDefinitionRemovals = selectedWordSet(body.selectedDefinitionRemovals);
    const dismissAll = body.dismissAll === true;
    const isAdmin = context.user?.isAdmin === true;

    if (isAdmin) {
      await applyAdminRelease({
        release,
        selectedPronunciationWords,
        selectedDefinitionWords,
        selectedPronunciationRemovals,
        selectedDefinitionRemovals,
        dismissAll,
      });
      return NextResponse.json({ success: true });
    }

    const profilesDocument = await readSmartAudioProfilesDocument(context.userId);
    const profileIndex = profilesDocument.profiles.findIndex(
      (profile) => profile.id === profilesDocument.selectedProfileId,
    );
    const resolvedIndex = profileIndex >= 0 ? profileIndex : 0;
    const activeProfile = profilesDocument.profiles[resolvedIndex];
    if (activeProfile) {
      const pronunciationRows = await db.select({ valueJson: adminSettings.valueJson })
        .from(adminSettings)
        .where(eq(adminSettings.key, 'global_pronunciations'))
        .limit(1);
      const definitionRows = await db.select({ valueJson: adminSettings.valueJson })
        .from(adminSettings)
        .where(eq(adminSettings.key, 'global_definitions'))
        .limit(1);
      const updates = buildDictionaryReleaseUpdates({
        gitPronunciations: release.pronunciations,
        gitDefinitions: release.definitions,
        tombstones: release.tombstones,
        globalPronunciations: parseSetting(pronunciationRows[0]?.valueJson),
        globalDefinitions: parseSetting(definitionRows[0]?.valueJson),
        activeProfile,
        isAdmin: false,
      });
      profilesDocument.profiles[resolvedIndex] = applyDictionaryReleaseToProfile({
        profile: activeProfile,
        gitPronunciations: release.pronunciations,
        tombstones: release.tombstones,
        selectedPronunciationWords: dismissAll
          ? new Set()
          : intersect(selectedPronunciationWords, availableWords(updates, 'pronunciation')),
        selectedPronunciationRemovals: dismissAll
          ? new Set()
          : intersect(selectedPronunciationRemovals, availableWords(updates, 'pronunciation-removal')),
        resolvedDictionaryHash: release.hash,
      });
      await writeSmartAudioProfilesDocument(context.userId, profilesDocument);
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    return errorResponse(error, {
      logger: serverLogger,
      event: 'tts.dictionary_release.apply.failed',
      msg: 'Failed to apply bundled dictionary release',
      apiErrorMessage: 'Failed to apply dictionary updates.',
    });
  }
}
