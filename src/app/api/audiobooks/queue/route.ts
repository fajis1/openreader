import { NextResponse, NextRequest } from 'next/server';
import { randomUUID } from 'node:crypto';
import { eq, and, asc, lt } from 'drizzle-orm';
import { db } from '@/db';
import { audiobookChapters, audiobookJobs, documents } from '@/db/schema';
import { requireAuthContext } from '@/lib/server/auth/auth';
import { serverLogger, errorToLog } from '@/lib/server/logger';
import { errorResponse } from '@/lib/server/errors/next-response';
import { runTaskNow } from '@/lib/server/tasks/engine';
import {
  findSmartAudioProfileById,
  readSmartAudioProfilesDocument,
} from '@/lib/server/smart-audio-profiles';
import { readBookLexicon } from '@/lib/server/smart-audio/book-lexicon';
import { isKokoroCompatiblePronunciation } from '@/lib/shared/kokoro-pronunciation-policy';
import { queuedAudiobookBatchVersion } from '@/lib/shared/audiobook-batching';

export const dynamic = 'force-dynamic';

function parseJobSettings(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object'
        ? parsed as Record<string, unknown>
        : {};
    } catch {
      return {};
    }
  }
  return value && typeof value === 'object'
    ? value as Record<string, unknown>
    : {};
}

export async function POST(req: NextRequest) {
  try {
    const ctxOrRes = await requireAuthContext(req);

    if (ctxOrRes instanceof Response) return ctxOrRes;
    if (!ctxOrRes.userId) return new NextResponse('Unauthorized', { status: 401 });
    const userId = ctxOrRes.userId;

    const body = await req.json();
    const { documentId, settings } = body;
    const confirmScholarAutoScan = body.confirmScholarAutoScan === true;
    const preflightOnly = body.preflightOnly === true;

    if (!documentId) {
      return NextResponse.json({ error: 'Missing documentId' }, { status: 400 });
    }

    const settingsRecord = settings && typeof settings === 'object'
      ? settings as Record<string, unknown>
      : {};
    const existingJobs = await db.select().from(audiobookJobs)
      .where(and(eq(audiobookJobs.userId, userId), eq(audiobookJobs.documentId, documentId)));
    
    // Only genuinely active jobs deduplicate. A fast completed job must not
    // block an immediate Resume request after a chapter is removed.
    const activeJob = existingJobs.find((j: typeof audiobookJobs.$inferSelect) =>
      j.status === 'queued' || 
      j.status === 'running' || 
      j.status === 'waiting_for_pdf' || 
      j.status === 'paused'
    );

    if (activeJob) {
      // The worker may already be performing an acknowledged Scholar auto-scan.
      // Deduplicate before the lexicon gate so retries do not ask for the same
      // confirmation again or mutate the settings captured by the worker.
      return NextResponse.json({ jobId: activeJob.id });
    }

    let resolvedSmartAudioProfileId: string | null = null;
    if (settingsRecord.useSmartAudio === true) {
      const profiles = await readSmartAudioProfilesDocument(userId);
      const profile = findSmartAudioProfileById(
        profiles,
        typeof settingsRecord.smartAudioProfileId === 'string'
          ? settingsRecord.smartAudioProfileId
          : profiles.selectedProfileId,
      );
      resolvedSmartAudioProfileId = profile?.id || null;
      if (profile?.workerMode === 'scholar') {
        const lexicon = await readBookLexicon(userId, documentId);
        const hasCompletedDefinitionScan = lexicon?.status === 'complete'
          && lexicon.definitionScanComplete === true
          && lexicon.profileId === profile.id
          && Object.values(lexicon.entries).every((entry) => (
            entry.pronunciation && isKokoroCompatiblePronunciation(entry.pronunciation)
          ));
        if (!hasCompletedDefinitionScan && !confirmScholarAutoScan) {
          return NextResponse.json({
            code: 'SCHOLAR_SCAN_REQUIRED',
            error: 'This book has not completed a pronunciation and definition scan.',
            message: 'Review the book pronunciations before generating. If you continue, OpenReader will scan unresolved foreign terms with the pronunciation model and adopt Gemini’s recommended defaults.',
          }, { status: 409 });
        }
      }
    }
    if (preflightOnly) {
      return NextResponse.json({
        ready: true,
        smartAudioProfileId: resolvedSmartAudioProfileId,
      });
    }
    const resolvedSettingsRecord: Record<string, unknown> = {
      ...settingsRecord,
      ...(resolvedSmartAudioProfileId
        ? { smartAudioProfileId: resolvedSmartAudioProfileId }
        : {}),
    };

    const jobId = randomUUID();
    const testNamespace = req.headers.get('x-openreader-test-namespace');
    const existingChapter = await db.select({ id: audiobookChapters.id })
      .from(audiobookChapters)
      .where(and(
        eq(audiobookChapters.userId, userId),
        eq(audiobookChapters.bookId, documentId),
      ))
      .limit(1);
    const previousJob = [...existingJobs]
      .sort((left, right) => (right.createdAt || 0) - (left.createdAt || 0))[0];
    const previousSettings = parseJobSettings(previousJob?.settingsJson);
    // Existing chapter indexes must keep the batching map that created them.
    // Jobs from before explicit versioning are therefore conservatively legacy.
    const cleanupBatchVersion = queuedAudiobookBatchVersion(
      existingChapter.length > 0,
      previousSettings.cleanupBatchVersion,
    );
    const settingsJson: Record<string, unknown> = {
      ...resolvedSettingsRecord,
      cleanupBatchVersion,
      ...(confirmScholarAutoScan ? { scholarAutoScan: true } : {}),
    };
    if (testNamespace) {
      settingsJson.testNamespace = testNamespace;
    }

    await db.insert(audiobookJobs).values({
      id: jobId,
      userId,
      documentId,
      status: 'queued',
      progress: 0,
      settingsJson,
    });

    runTaskNow('process-audiobook-queue').catch((err) => serverLogger.error({ event: 'audiobook.queue.wake.error', error: errorToLog(err) }, 'Failed to wake queue'));
    return NextResponse.json({ jobId });
  } catch (error) {
    serverLogger.error({ event: 'audiobook.queue.post.error', error: errorToLog(error) }, 'Failed to queue audiobook');
    return errorResponse(error, { apiErrorMessage: 'Failed to queue audiobook' });
  }
}

export async function GET(req: NextRequest) {
  try {
    const ctxOrRes = await requireAuthContext(req);
    if (ctxOrRes instanceof Response) return ctxOrRes;
    if (!ctxOrRes.userId) return new NextResponse('Unauthorized', { status: 401 });
    const userId = ctxOrRes.userId;

    const url = new URL(req.url);
    const jobId = url.searchParams.get('jobId');

    if (jobId) {
      const jobRows = await db
        .select()
        .from(audiobookJobs)
        .where(and(eq(audiobookJobs.id, jobId), eq(audiobookJobs.userId, userId)));

      if (jobRows.length === 0) {
        return NextResponse.json({ error: 'Job not found' }, { status: 404 });
      }

      const job = jobRows[0];
      let queuePosition = 0;

      if (job.status === 'queued') {
        const olderJobs = await db
          .select()
          .from(audiobookJobs)
          .where(and(eq(audiobookJobs.status, 'queued'), lt(audiobookJobs.createdAt, job.createdAt!)));
        queuePosition = olderJobs.length + 1;
      }

      return NextResponse.json({ job, queuePosition });
    }

    // List all active jobs for the user
    const userJobsRaw = await db
      .select({
        job: audiobookJobs,
        documentTitle: documents.name,
      })
      .from(audiobookJobs)
      .leftJoin(documents, eq(audiobookJobs.documentId, documents.id))
      .where(eq(audiobookJobs.userId, userId))
      .orderBy(asc(audiobookJobs.createdAt));

    const userJobs = userJobsRaw.map((row: typeof userJobsRaw[0]) => ({
      ...row.job,
      documentTitle: row.documentTitle,
      globalQueuePosition: 0
    }));

    const runningJobs = await db
      .select({ startedAt: audiobookJobs.startedAt, updatedAt: audiobookJobs.updatedAt, progress: audiobookJobs.progress })
      .from(audiobookJobs)
      .where(eq(audiobookJobs.status, 'running'))
      .limit(1);

    for (const job of userJobs) {
      if (job.status === 'queued' || job.status === 'waiting_for_pdf') {
        const olderJobs = await db
          .select({ id: audiobookJobs.id })
          .from(audiobookJobs)
          .where(and(eq(audiobookJobs.status, 'queued'), lt(audiobookJobs.createdAt, job.createdAt!)));
        job.globalQueuePosition = olderJobs.length + 1;
      }
    }

    return NextResponse.json({ jobs: userJobs, activeGlobalJob: runningJobs.length > 0 ? runningJobs[0] : null });
  } catch (error) {
    serverLogger.error({ event: 'audiobook.queue.get.error', error: errorToLog(error) }, 'Failed to list audiobook jobs');
    return errorResponse(error, { apiErrorMessage: 'Failed to list audiobook jobs' });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const ctxOrRes = await requireAuthContext(req);
    if (ctxOrRes instanceof Response) return ctxOrRes;
    if (!ctxOrRes.userId) return new NextResponse('Unauthorized', { status: 401 });
    
    const url = new URL(req.url);
    const id = url.searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

    await db.delete(audiobookJobs).where(and(eq(audiobookJobs.id, id), eq(audiobookJobs.userId, ctxOrRes.userId)));
    return NextResponse.json({ success: true });
  } catch (error) {
    serverLogger.error({ event: 'audiobook.queue.delete.error', error: errorToLog(error) }, 'Failed to delete audiobook job');
    return errorResponse(error, { apiErrorMessage: 'Failed to delete audiobook job' });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const ctxOrRes = await requireAuthContext(req);
    if (ctxOrRes instanceof Response) return ctxOrRes;
    if (!ctxOrRes.userId) return new NextResponse('Unauthorized', { status: 401 });
    
    const body = await req.json();
    const { id } = body;
    if (!id) return NextResponse.json({ error: 'Missing id' }, { status: 400 });

    await db.update(audiobookJobs)
      .set({ status: 'queued', error: null, progress: 0, startedAt: null, updatedAt: Date.now() })
      .where(and(eq(audiobookJobs.id, id), eq(audiobookJobs.userId, ctxOrRes.userId)));
      
    runTaskNow('process-audiobook-queue').catch((err) => serverLogger.error({ event: 'audiobook.queue.wake.error', error: errorToLog(err) }, 'Failed to wake queue'));
    return NextResponse.json({ success: true });
  } catch (error) {
    serverLogger.error({ event: 'audiobook.queue.put.error', error: errorToLog(error) }, 'Failed to requeue audiobook job');
    return errorResponse(error, { apiErrorMessage: 'Failed to requeue audiobook job' });
  }
}
