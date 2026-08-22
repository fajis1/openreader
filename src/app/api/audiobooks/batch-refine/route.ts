import { NextResponse } from 'next/server';
import { db } from '@/db';
import { audiobookJobs, documents } from '@/db/schema';
import { eq, and } from 'drizzle-orm';
import { requireAuthContext } from '@/lib/server/auth/auth';
import { randomUUID } from 'node:crypto';

export async function POST(request: Request) {
  try {
    const ctx = await requireAuthContext(request);
    if (ctx instanceof Response) return ctx;
    const userId = ctx.userId;
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await request.json();
    const { bookId, rule } = body;

    if (!bookId || !rule) {
      return NextResponse.json({ error: 'bookId and rule are required' }, { status: 400 });
    }

    // Verify ownership
    const doc = await db.query.documents.findFirst({
      where: and(eq(documents.id, bookId), eq(documents.userId, userId))
    });

    if (!doc) {
      return NextResponse.json({ error: 'Document not found' }, { status: 404 });
    }

    const jobId = randomUUID();

    await db.insert(audiobookJobs).values({
      id: jobId,
      userId,
      documentId: bookId,
      status: 'queued',
      progress: 0,
      settingsJson: { jobType: 'batch-refine', rule },
      createdAt: Date.now(),
      updatedAt: Date.now()
    });

    return NextResponse.json({ success: true, jobId, message: 'Batch refine job queued successfully.' });
  } catch (err: any) {
    console.error('Batch refine start failed:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
