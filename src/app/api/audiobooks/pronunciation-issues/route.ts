import { NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { documents } from '@/db/schema';
import { requireAuthContext } from '@/lib/server/auth/auth';
import { pronunciationCatalog, pronunciationDictionary, readPronunciationChapter, proposePronunciationRepair, resumeRepairedPronunciationJob, existingPronunciationRepair } from '@/lib/server/audiobooks/pronunciation-repairs';
import { scanPronunciationIssues } from '@/lib/shared/pronunciation-issues';
import { runTaskNow } from '@/lib/server/tasks/engine';
import { errorResponse } from '@/lib/server/errors/next-response';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

async function ownedUser(request: Request, bookId: string): Promise<string | Response> {
  const ctx = await requireAuthContext(request);
  if (ctx instanceof Response) return ctx;
  if (!ctx.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const rows = await db.select({ id: documents.id }).from(documents).where(and(eq(documents.id, bookId), eq(documents.userId, ctx.userId))).limit(1);
  return rows.length ? ctx.userId : NextResponse.json({ error: 'Document not found' }, { status: 404 });
}

export async function GET(request: Request) {
  try {
    const bookId = new URL(request.url).searchParams.get('bookId') || '';
    const user = await ownedUser(request, bookId);
    if (user instanceof Response) return user;
    return NextResponse.json(await pronunciationCatalog(bookId, user));
  } catch (error) {
    return errorResponse(error, { apiErrorMessage: 'Could not list audiobook chapters.' });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    if (typeof body.bookId !== 'string' || typeof body.fileName !== 'string') return NextResponse.json({ error: 'Book and chapter are required.' }, { status: 400 });
    const user = await ownedUser(request, body.bookId);
    if (user instanceof Response) return user;
    const profileId = typeof body.profileId === 'string' ? body.profileId : undefined;
    if (body.action === 'scan') {
      const chapter = await readPronunciationChapter(body.bookId, user, body.fileName);
      const { dictionary } = await pronunciationDictionary(user, body.bookId, chapter.profileId || profileId);
      const existing = await existingPronunciationRepair(body.bookId, user, body.fileName, chapter.hash);
      return NextResponse.json({ fileName: body.fileName, chapterIndex: chapter.chapterIndex, title: chapter.title, failed: chapter.failed,
        hash: chapter.hash, jobId: chapter.jobId, failureError: chapter.failureError, ...existing, issues: scanPronunciationIssues(chapter.text, dictionary) });
    }
    if (body.action === 'propose' && typeof body.hash === 'string') {
      return NextResponse.json(await proposePronunciationRepair({ bookId: body.bookId, userId: user, fileName: body.fileName, hash: body.hash, profileId, signal: request.signal,
        manualPatches: Array.isArray(body.manualPatches) ? body.manualPatches : undefined }));
    }
    if (body.action === 'resume') {
      const jobId = await resumeRepairedPronunciationJob(body.bookId, user, body.fileName);
      void runTaskNow('process-audiobook-queue').catch(() => {});
      return NextResponse.json({ jobId });
    }
    return NextResponse.json({ error: 'Unknown scan action.' }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Pronunciation repair failed.' }, { status: 409 });
  }
}
