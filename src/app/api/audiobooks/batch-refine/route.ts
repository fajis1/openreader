import { randomUUID } from 'node:crypto';

import { and, eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import { db } from '@/db';
import { audiobookJobs, documents } from '@/db/schema';
import { requireAuthContext } from '@/lib/server/auth/auth';
import { createBatchRefineRun } from '@/lib/server/audiobooks/batch-refine-review-store';
import {
  findSmartAudioProfileById,
  readSmartAudioProfilesDocument,
} from '@/lib/server/smart-audio-profiles';
import { runTaskNow } from '@/lib/server/tasks/engine';
import {
  BATCH_REFINE_RECORDING_OPTION_HELP,
  normalizeBatchRefineRecordingMode,
  resolveBatchRefineProfileCategory,
} from '@/lib/shared/batch-refine-review';
import { errorResponse } from '@/lib/server/errors/next-response';
import { errorToLog, serverLogger } from '@/lib/server/logger';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const ctx = await requireAuthContext(request);
    if (ctx instanceof Response) return ctx;
    const userId = ctx.userId;
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await request.json() as Record<string, unknown>;
    const bookId = typeof body.bookId === 'string' ? body.bookId : '';
    const rule = typeof body.rule === 'string' ? body.rule.trim() : '';
    const aiModel = typeof body.aiModel === 'string' ? body.aiModel : undefined;
    if (!bookId || !rule) {
      return NextResponse.json({ error: 'bookId and rule are required' }, { status: 400 });
    }

    const document = await db.select({ id: documents.id }).from(documents).where(and(
      eq(documents.id, bookId),
      eq(documents.userId, userId),
    )).limit(1);
    if (!document[0]) return NextResponse.json({ error: 'Document not found' }, { status: 404 });

    const profilesDocument = await readSmartAudioProfilesDocument(userId);
    const requestedProfileId = typeof body.smartAudioProfileId === 'string'
      ? body.smartAudioProfileId
      : profilesDocument.selectedProfileId;
    const profile = findSmartAudioProfileById(profilesDocument, requestedProfileId);
    if (!profile) return NextResponse.json({ error: 'Smart Audio profile not found' }, { status: 400 });
    if (!(profile.geminiApiKey || process.env.GEMINI_API_KEY || '').trim()
      && !(profile.backupGeminiApiKey || process.env.BACKUP_GEMINI_API_KEY || '').trim()) {
      return NextResponse.json({
        error: 'Add a Gemini API key to the selected Smart Audio profile before starting Batch Refine.',
      }, { status: 400 });
    }

    const recordingMode = normalizeBatchRefineRecordingMode(body.recordingMode);
    const holdHighPriority = body.holdHighPriority !== false;
    const profileCategory = resolveBatchRefineProfileCategory(profile);
    const jobId = randomUUID();
    const runId = randomUUID();

    await db.insert(audiobookJobs).values({
      id: jobId,
      userId,
      documentId: bookId,
      status: 'queued',
      progress: 0,
      settingsJson: {
        jobType: 'batch-refine',
        rule,
        aiModel,
        batchRefineRunId: runId,
        smartAudioProfileId: profile.id,
        profileCategory,
        recordingMode,
        holdHighPriority,
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });

    try {
      await createBatchRefineRun({
        id: runId,
        jobId,
        userId,
        documentId: bookId,
        profileId: profile.id,
        profileCategory,
        rule,
        recordingMode,
        holdHighPriority,
      });
    } catch (error) {
      await db.delete(audiobookJobs).where(and(
        eq(audiobookJobs.id, jobId),
        eq(audiobookJobs.userId, userId),
      ));
      throw error;
    }

    void runTaskNow('process-audiobook-queue').catch((error) => {
      serverLogger.warn({
        event: 'audiobook.batch_refine.queue_wake_failed',
        error: errorToLog(error),
      }, 'Failed to wake the audiobook queue immediately');
    });
    return NextResponse.json({
      success: true,
      jobId,
      runId,
      message: recordingMode === 'immediate'
        ? 'Batch Refine queued. Eligible changes will record as they are approved automatically.'
        : 'Batch Refine queued. Changes will wait for review before recording.',
    });
  } catch (error) {
    return errorResponse(error, {
      logger: serverLogger,
      event: 'audiobook.batch_refine.start_failed',
      msg: 'Batch Refine could not be started',
      apiErrorMessage: 'Batch Refine could not be started.',
      normalize: { code: 'BATCH_REFINE_START_FAILED', errorClass: 'db' },
    });
  }
}

export async function GET(request: Request) {
  try {
    const ctx = await requireAuthContext(request);
    if (ctx instanceof Response) return ctx;
    const userId = ctx.userId;
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const url = new URL(request.url);
    const bookId = url.searchParams.get('bookId');
    if (!bookId) return NextResponse.json({ error: 'bookId is required' }, { status: 400 });

    const document = await db.select({ id: documents.id }).from(documents).where(and(
      eq(documents.id, bookId),
      eq(documents.userId, userId),
    )).limit(1);
    if (!document[0]) return NextResponse.json({ error: 'Document not found' }, { status: 404 });

    const profilesDocument = await readSmartAudioProfilesDocument(userId);
    const requestedProfileId = url.searchParams.get('smartAudioProfileId')
      || profilesDocument.selectedProfileId;
    const profile = findSmartAudioProfileById(profilesDocument, requestedProfileId)
      || profilesDocument.profiles[0];
    const primaryKey = (profile?.geminiApiKey || process.env.GEMINI_API_KEY || '').trim();
    const backupKey = (profile?.backupGeminiApiKey || process.env.BACKUP_GEMINI_API_KEY || '').trim();
    const maskKey = (key: string) => key.length > 4 ? `...${key.slice(-4)}` : (key ? '***' : 'Not Set');

    const jobs = await db.select().from(audiobookJobs).where(and(
      eq(audiobookJobs.documentId, bookId),
      eq(audiobookJobs.userId, userId),
    ));
    const activeJob = jobs.find((job: typeof audiobookJobs.$inferSelect) => (
      job.status === 'queued' || job.status === 'running'
    )) || null;

    return NextResponse.json({
      job: activeJob,
      primaryKeyMasked: maskKey(primaryKey),
      backupKeyMasked: maskKey(backupKey),
      defaultModel: profile?.pronunciationAiModel || 'gemini-2.5-flash',
      selectedProfileId: profile?.id || null,
      selectedProfileName: profile?.name || 'Standard audiobook',
      profileCategory: resolveBatchRefineProfileCategory(profile),
      recordingOptions: BATCH_REFINE_RECORDING_OPTION_HELP,
    });
  } catch (error) {
    return errorResponse(error, {
      logger: serverLogger,
      event: 'audiobook.batch_refine.settings_load_failed',
      msg: 'Batch Refine settings could not be loaded',
      apiErrorMessage: 'Batch Refine settings could not be loaded.',
      normalize: { code: 'BATCH_REFINE_SETTINGS_LOAD_FAILED', errorClass: 'db' },
    });
  }
}
