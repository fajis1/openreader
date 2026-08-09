import { NextRequest, NextResponse } from 'next/server';
import { and, eq, or, sql } from 'drizzle-orm';

import { db } from '@/db';
import { audiobookJobs, documents, documentSettings } from '@/db/schema';
import { requireAuthContext } from '@/lib/server/auth/auth';
import {
  buildCharacterScanSource,
  loadCanonicalAudiobookSource,
  PdfCharacterSourcePendingError,
} from '@/lib/server/audiobooks/document-source';
import { errorResponse } from '@/lib/server/errors/next-response';
import { errorToLog, serverLogger } from '@/lib/server/logger';
import {
  findSmartAudioProfileById,
  readSmartAudioProfilesDocument,
} from '@/lib/server/smart-audio-profiles';
import { getOpenReaderTestNamespace } from '@/lib/server/testing/test-namespace';
import { runTaskNow } from '@/lib/server/tasks/engine';
import { mergeDocumentSettings } from '@/lib/shared/document-settings';
import {
  finalizeSmartAudioCharacterMap,
  getCharacterMapReadiness,
  mergeExtractedCharacters,
  MULTI_VOICE_WORKER_MODE,
  WAITING_FOR_VOICES_STATUS,
} from '@/lib/shared/multi-voice';
import { resolveCleanupAiModel } from '@/lib/shared/smart-audio-models';
import { DEFAULT_DOCUMENT_SETTINGS, type SmartAudioCharacterMap } from '@/types/document-settings';

export const dynamic = 'force-dynamic';

type OwnedDocument = {
  id: string;
  type: string;
};

function parseStoredSettings(value: unknown) {
  if (typeof value !== 'string') return mergeDocumentSettings(DEFAULT_DOCUMENT_SETTINGS, value);
  try {
    return mergeDocumentSettings(DEFAULT_DOCUMENT_SETTINGS, JSON.parse(value));
  } catch {
    return mergeDocumentSettings(DEFAULT_DOCUMENT_SETTINGS, null);
  }
}

async function loadScope(request: NextRequest, documentId: string, profileId: string) {
  const context = await requireAuthContext(request);
  if (context instanceof Response) return context;
  if (!context.userId) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  const userId = context.userId;
  const documentRows = await db.select({
    id: documents.id,
    type: documents.type,
  }).from(documents).where(and(
    eq(documents.id, documentId),
    eq(documents.userId, userId),
  )).limit(1);
  const document = documentRows[0] as OwnedDocument | undefined;
  if (!document) return NextResponse.json({ error: 'Document not found.' }, { status: 404 });

  const profiles = await readSmartAudioProfilesDocument(userId);
  const profile = findSmartAudioProfileById(profiles, profileId);
  if (!profile) return NextResponse.json({ error: 'Smart Audio profile not found.' }, { status: 404 });
  if (profile.workerMode !== MULTI_VOICE_WORKER_MODE) {
    return NextResponse.json({ error: 'The selected profile is not an Audio Drama profile.' }, { status: 400 });
  }
  const settingRows = await db.select({ dataJson: documentSettings.dataJson })
    .from(documentSettings)
    .where(and(
      eq(documentSettings.documentId, documentId),
      eq(documentSettings.userId, userId),
    ))
    .limit(1);
  return {
    context,
    userId,
    document,
    profile,
    settings: parseStoredSettings(settingRows[0]?.dataJson),
  };
}

async function saveCharacterMap(input: {
  documentId: string;
  userId: string;
  characterMap: SmartAudioCharacterMap;
}): Promise<void> {
  const serialized = JSON.stringify(input.characterMap);
  const initialData = process.env.POSTGRES_URL
    ? { schemaVersion: 1, smartAudioCharacters: input.characterMap }
    : JSON.stringify({ schemaVersion: 1, smartAudioCharacters: input.characterMap });
  const mergedData = process.env.POSTGRES_URL
    ? sql`jsonb_set(coalesce(${documentSettings.dataJson}, '{}'::jsonb), '{smartAudioCharacters}', ${serialized}::jsonb, true)`
    : sql`json_set(coalesce(${documentSettings.dataJson}, '{}'), '$.smartAudioCharacters', json(${serialized}))`;
  await db.insert(documentSettings).values({
    documentId: input.documentId,
    userId: input.userId,
    dataJson: initialData as never,
    clientUpdatedAtMs: 0,
    updatedAt: Date.now(),
  }).onConflictDoUpdate({
    target: [documentSettings.documentId, documentSettings.userId],
    set: {
      dataJson: mergedData as never,
      updatedAt: Date.now(),
    },
  });
}

function requestIds(request: NextRequest): { documentId: string; profileId: string } {
  const url = new URL(request.url);
  return {
    documentId: (url.searchParams.get('documentId') || '').trim().toLowerCase(),
    profileId: (url.searchParams.get('profileId') || '').trim(),
  };
}

export async function GET(request: NextRequest) {
  try {
    const { documentId, profileId } = requestIds(request);
    if (!documentId || !profileId) {
      return NextResponse.json({ error: 'Document ID and profile ID are required.' }, { status: 400 });
    }
    const scope = await loadScope(request, documentId, profileId);
    if (scope instanceof Response) return scope;
    const readiness = getCharacterMapReadiness(scope.settings.smartAudioCharacters);
    return NextResponse.json({
      characterMap: readiness.map,
      ready: readiness.ready && readiness.map?.profileId === profileId,
      unassigned: readiness.unassigned,
      errors: readiness.errors,
    });
  } catch (error) {
    return errorResponse(error, {
      logger: serverLogger,
      event: 'audiobook.multivoice.cast.load_failed',
      apiErrorMessage: 'Failed to load the character cast.',
    });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const documentId = typeof body.documentId === 'string' ? body.documentId.trim().toLowerCase() : '';
    const profileId = typeof body.profileId === 'string' ? body.profileId.trim() : '';
    if (!documentId || !profileId) {
      return NextResponse.json({ error: 'Document ID and profile ID are required.' }, { status: 400 });
    }
    const scope = await loadScope(request, documentId, profileId);
    if (scope instanceof Response) return scope;
    const geminiApiKey = (scope.profile.geminiApiKey || '').trim();
    if (!geminiApiKey) {
      return NextResponse.json({ error: 'The selected profile needs a Gemini API key.' }, { status: 400 });
    }

    let source;
    try {
      const chapters = await loadCanonicalAudiobookSource({
        document: scope.document,
        namespace: getOpenReaderTestNamespace(request.headers),
        settings: scope.settings,
      });
      source = buildCharacterScanSource(chapters);
    } catch (error) {
      if (error instanceof PdfCharacterSourcePendingError) {
        return NextResponse.json({
          code: 'PDF_PARSE_PENDING',
          message: error.message,
          operationId: error.operationId,
          retryAfterMs: 2_000,
        }, { status: 202 });
      }
      throw error;
    }

    const { connect, StringCodec } = await import('nats');
    const connection = await connect({
      servers: process.env.NATS_URL || 'nats://127.0.0.1:4222',
      maxReconnectAttempts: 1,
      timeout: 2_000,
    });
    try {
      const codec = StringCodec();
      const response = await connection.request(
        'audiobooks.multivoice.extract',
        codec.encode(JSON.stringify({
          user_id: scope.userId,
          api_key: geminiApiKey,
          backup_api_key: (scope.profile.backupGeminiApiKey || '').trim(),
          raw_text: source.text,
          ai_model: resolveCleanupAiModel(scope.profile),
        })),
        { timeout: 300_000 },
      );
      const workerResult = JSON.parse(codec.decode(response.data)) as Record<string, unknown>;
      if (workerResult.status === 'rate_limit') {
        return NextResponse.json({
          code: 'GEMINI_RATE_LIMITED',
          error: 'Gemini temporarily paused character scanning. Try again shortly.',
        }, { status: 429 });
      }
      if (workerResult.status !== 'success') {
        throw new Error(typeof workerResult.message === 'string'
          ? workerResult.message
          : 'Character extraction failed.');
      }
      const characterMap = mergeExtractedCharacters({
        previous: scope.settings.smartAudioCharacters,
        characters: workerResult.characters,
        profileId,
        sourceFingerprint: source.sourceFingerprint,
      });
      await saveCharacterMap({
        documentId,
        userId: scope.userId,
        characterMap,
      });
      serverLogger.info({
        event: 'audiobook.multivoice.cast.scanned',
        documentId,
        characters: Object.keys(characterMap.entries).length,
        sourceCharacters: source.sourceCharacters,
        sampledCharacters: source.text.length,
      }, 'Extracted an Audio Drama character cast from canonical audiobook text.');
      return NextResponse.json({ success: true, characterMap });
    } finally {
      await connection.close();
    }
  } catch (error) {
    serverLogger.error({
      event: 'audiobook.multivoice.cast.scan_failed',
      error: errorToLog(error),
    }, 'Failed to scan Audio Drama characters.');
    return errorResponse(error, { apiErrorMessage: 'Failed to scan audiobook characters.' });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const documentId = typeof body.documentId === 'string' ? body.documentId.trim().toLowerCase() : '';
    const profileId = typeof body.profileId === 'string' ? body.profileId.trim() : '';
    const jobId = typeof body.jobId === 'string' ? body.jobId.trim() : '';
    if (!documentId || !profileId) {
      return NextResponse.json({ error: 'Document ID and profile ID are required.' }, { status: 400 });
    }
    const scope = await loadScope(request, documentId, profileId);
    if (scope instanceof Response) return scope;
    const characterMap = finalizeSmartAudioCharacterMap(body.characterMap);
    characterMap.profileId = profileId;
    characterMap.sourceFingerprint = characterMap.sourceFingerprint
      || scope.settings.smartAudioCharacters?.sourceFingerprint;
    await saveCharacterMap({ documentId, userId: scope.userId, characterMap });

    if (jobId) {
      await db.update(audiobookJobs).set({
        status: 'queued',
        error: null,
        updatedAt: Date.now(),
      }).where(and(
        eq(audiobookJobs.id, jobId),
        eq(audiobookJobs.userId, scope.userId),
        eq(audiobookJobs.documentId, documentId),
        or(
          eq(audiobookJobs.status, WAITING_FOR_VOICES_STATUS),
          and(
            eq(audiobookJobs.status, 'queued'),
            eq(audiobookJobs.error, 'waiting_for_voices'),
          ),
        ),
      ));
      runTaskNow('process-audiobook-queue').catch((error) => serverLogger.error({
        event: 'audiobook.multivoice.cast.resume_failed',
        error: errorToLog(error),
      }, 'Failed to wake the audiobook queue after casting.'));
    }
    return NextResponse.json({ success: true, characterMap });
  } catch (error) {
    return errorResponse(error, {
      logger: serverLogger,
      event: 'audiobook.multivoice.cast.save_failed',
      apiErrorMessage: 'Failed to save the character cast.',
    });
  }
}
