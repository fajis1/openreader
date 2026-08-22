import { NextResponse } from 'next/server';
import { db } from '@/db';
import { audiobookJobs, documents, userPreferences, documentSettings } from '@/db/schema';
import { eq, and } from 'drizzle-orm';
import { requireAuthContext } from '@/lib/server/auth/auth';
import { randomUUID } from 'node:crypto';
import { runTaskNow } from '@/lib/server/tasks/engine';
import { readSmartAudioProfilesDocument, findSmartAudioProfileById } from '@/lib/server/smart-audio-profiles';

export async function POST(request: Request) {
  try {
    const ctx = await requireAuthContext(request);
    if (ctx instanceof Response) return ctx;
    const userId = ctx.userId;
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await request.json();
    const { bookId, rule, aiModel, newApiKey, newBackupKey } = body;

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

    
    if (newApiKey || newBackupKey) {
      const updates: any = {};
      if (newApiKey) updates.geminiApiKey = newApiKey;
      if (newBackupKey) updates.backupGeminiApiKey = newBackupKey;
      await db.update(userPreferences).set(updates).where(eq(userPreferences.userId, userId));
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

    // Immediately trigger the background worker instead of waiting for the 1-minute cron
    void runTaskNow('process-audiobook-queue').catch((err) => {
      console.error('Failed to wake background worker immediately:', err);
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

    const userRows = await db.select().from(userPreferences).where(eq(userPreferences.userId, userId)).limit(1);
    
    const settingsRows = await db.select().from(documentSettings).where(eq(documentSettings.documentId, bookId)).limit(1);
    const selectedProfileId = (settingsRows[0]?.settingsJson as any)?.audiobookProfileId || 'default';
    
    
    const profilesDoc = await readSmartAudioProfilesDocument(userId);
    const profile = await findSmartAudioProfileById(profilesDoc, selectedProfileId);
    
    const globalKey = userRows[0]?.geminiApiKey || process.env.GEMINI_API_KEY || '';
    const globalBackupKey = userRows[0]?.backupGeminiApiKey || process.env.BACKUP_GEMINI_API_KEY || '';
    
    const primaryKey = (profile?.geminiApiKey || globalKey).trim();
    const backupKey = (profile?.backupGeminiApiKey || globalBackupKey).trim();
    const resolvedModel = profile?.pronunciationAiModel || 'gemini-2.5-flash';
    
    const maskKey = (key: string) => key.length > 4 ? `...${key.slice(-4)}` : (key ? '***' : 'Not Set');

    const availableKeys = profilesDoc.profiles
      .filter(p => p.geminiApiKey && p.geminiApiKey.trim().length > 0)
      .map(p => ({
        id: p.id,
        name: p.name || 'Unnamed Profile',
        key: p.geminiApiKey,
        masked: maskKey(p.geminiApiKey || "")
      }));

    return NextResponse.json({
      primaryKeyMasked: maskKey(primaryKey),
      backupKeyMasked: maskKey(backupKey),
      defaultModel: resolvedModel,
      availableKeys
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
