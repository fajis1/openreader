import { NextResponse, NextRequest } from 'next/server';
import { randomUUID } from 'node:crypto';
import { eq, and, asc, lt } from 'drizzle-orm';
import { db } from '@/db';
import { audiobookJobs, documents } from '@/db/schema';
import { requireAuthContext } from '@/lib/server/auth/auth';
import { serverLogger, errorToLog } from '@/lib/server/logger';
import { errorResponse } from '@/lib/server/errors/next-response';
import { runTaskNow } from '@/lib/server/tasks/engine';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const ctxOrRes = await requireAuthContext(req);

    if (ctxOrRes instanceof Response) return ctxOrRes;
    if (!ctxOrRes.userId) return new NextResponse('Unauthorized', { status: 401 });
    const userId = ctxOrRes.userId;

    const body = await req.json();
    const { documentId, settings } = body;

    if (!documentId) {
      return NextResponse.json({ error: 'Missing documentId' }, { status: 400 });
    }

    const now = Date.now();
    const existingJobs = await db.select().from(audiobookJobs)
      .where(and(eq(audiobookJobs.userId, userId), eq(audiobookJobs.documentId, documentId)));
    
    // Check if an active job already exists or one was just created within 5 seconds
    const activeOrRecent = existingJobs.find((j: typeof audiobookJobs.$inferSelect) => 
      j.status === 'queued' || 
      j.status === 'running' || 
      j.status === 'waiting_for_pdf' || 
      j.status === 'paused' ||
      (now - (j.createdAt || 0) < 5000)
    );

    if (activeOrRecent) {
      return NextResponse.json({ jobId: activeOrRecent.id });
    }

    const jobId = randomUUID();
    const testNamespace = req.headers.get('x-openreader-test-namespace');
    const settingsJson = { ...(settings || {}) };
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
    }));

    return NextResponse.json({ jobs: userJobs });
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
