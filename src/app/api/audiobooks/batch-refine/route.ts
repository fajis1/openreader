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
    const { bookId, rule, aiModel, newApiKey } = body;

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

    
    if (newApiKey) {
      const { user } = await import('@/db/schema');
      await db.update(user).set({ geminiApiKey: newApiKey }).where(eq(user.id, userId));
    }
    const jobId = randomUUID();

    await db.insert(audiobookJobs).values({
      id: jobId,
      userId,
      documentId: bookId,
      status: 'queued',
      progress: 0,
      settingsJson: { jobType: 'batch-refine', rule, aiModel },
      createdAt: Date.now(),
      updatedAt: Date.now()
    });

    return NextResponse.json({ success: true, jobId, message: 'Batch refine job queued successfully.' });
  } catch (err: any) {
    console.error('Batch refine start failed:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
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

    const { user, documentSettings } = await import('@/db/schema');
    const userRows = await db.select().from(user).where(eq(user.id, userId)).limit(1);
    
    const settingsRows = await db.select().from(documentSettings).where(eq(documentSettings.documentId, bookId)).limit(1);
    const selectedProfileId = (settingsRows[0]?.settingsJson as any)?.audiobookProfileId || 'default';
    
    const { readSmartAudioProfilesDocument, findSmartAudioProfileById } = await import('@/lib/server/smart-audio-profiles');
    const profilesDoc = await readSmartAudioProfilesDocument(userId);
    const profile = await findSmartAudioProfileById(profilesDoc, selectedProfileId);
    
    const globalKey = userRows[0]?.geminiApiKey || process.env.GEMINI_API_KEY || '';
    const globalBackupKey = userRows[0]?.backupGeminiApiKey || process.env.BACKUP_GEMINI_API_KEY || '';
    
    const primaryKey = (profile?.geminiApiKey || globalKey).trim();
    const backupKey = (profile?.backupGeminiApiKey || globalBackupKey).trim();
    const resolvedModel = profile?.pronunciationAiModel || 'gemini-2.5-flash';
    
    const maskKey = (key) => key.length > 4 ? `...${key.slice(-4)}` : (key ? '***' : 'Not Set');

    return NextResponse.json({
      primaryKeyMasked: maskKey(primaryKey),
      backupKeyMasked: maskKey(backupKey),
      defaultModel: resolvedModel
    });
  } catch (err) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
