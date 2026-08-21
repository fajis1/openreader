import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { audiobookJobs } from '@/db/schema';
import { requireAuthContext } from '@/lib/server/auth/auth';

export const dynamic = 'force-dynamic';

const SAFE_ID_REGEX = /^[a-zA-Z0-9._-]{1,128}$/;

function isSafeId(value: string): boolean {
  return SAFE_ID_REGEX.test(value);
}

export async function GET(request: NextRequest) {
  const bookId = request.nextUrl.searchParams.get('bookId');
  if (!bookId || !isSafeId(bookId)) {
    return NextResponse.json({ error: 'Invalid bookId' }, { status: 400 });
  }

  const ctxOrRes = await requireAuthContext(request);
  if (ctxOrRes instanceof Response) return ctxOrRes;
  if (!ctxOrRes.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const format = request.nextUrl.searchParams.get('format');
  if (!format) return NextResponse.json({ error: 'Missing format' }, { status: 400 });

  const jobs = await db.select()
    .from(audiobookJobs)
    .where(and(
      eq(audiobookJobs.documentId, bookId),
      eq(audiobookJobs.userId, ctxOrRes.userId)
    ))
    .orderBy(audiobookJobs.createdAt);

  let combineJob = null;
  for (let i = jobs.length - 1; i >= 0; i--) {
    const job = jobs[i];
    const settings = typeof job.settingsJson === 'string' ? JSON.parse(job.settingsJson) : (job.settingsJson || {});
    if (settings.jobType === 'combine' && settings.format === format) {
      combineJob = job;
      break;
    }
  }

  if (!combineJob) {
    return NextResponse.json({ status: 'not_found' });
  }

  return NextResponse.json({
    status: combineJob.status,
    progress: combineJob.progress,
    error: combineJob.error,
  });
}
