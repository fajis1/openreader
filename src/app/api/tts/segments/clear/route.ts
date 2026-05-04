import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { ttsSegments } from '@/db/schema';
import { deleteTtsSegmentAudioObjects } from '@/lib/server/tts/segments-blobstore';
import { resolveSegmentDocumentScope } from '@/lib/server/tts/segments-auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function parseBody(value: unknown): { documentId: string } | null {
  if (!value || typeof value !== 'object') return null;
  const rec = value as Record<string, unknown>;
  if (typeof rec.documentId !== 'string' || !rec.documentId.trim()) return null;
  return { documentId: rec.documentId.trim().toLowerCase() };
}

export async function POST(request: NextRequest) {
  try {
    const parsed = parseBody(await request.json().catch(() => null));
    if (!parsed) {
      return NextResponse.json({ error: 'Invalid request payload' }, { status: 400 });
    }

    const scope = await resolveSegmentDocumentScope(request, parsed.documentId);
    if (scope instanceof Response) return scope;

    const rows = (await db
      .select({
        segmentId: ttsSegments.segmentId,
        audioKey: ttsSegments.audioKey,
      })
      .from(ttsSegments)
      .where(and(
        eq(ttsSegments.userId, scope.storageUserId),
        eq(ttsSegments.documentId, parsed.documentId),
        eq(ttsSegments.documentVersion, scope.documentVersion),
      ))) as Array<{ segmentId: string; audioKey: string | null }>;

    await db
      .delete(ttsSegments)
      .where(and(
        eq(ttsSegments.userId, scope.storageUserId),
        eq(ttsSegments.documentId, parsed.documentId),
        eq(ttsSegments.documentVersion, scope.documentVersion),
      ));

    const audioKeys = rows
      .map((row) => row.audioKey)
      .filter((key): key is string => Boolean(key));

    let deletedAudioObjects = 0;
    let warning: string | undefined;
    if (audioKeys.length > 0) {
      try {
        deletedAudioObjects = await deleteTtsSegmentAudioObjects(audioKeys);
      } catch (error) {
        warning = error instanceof Error ? error.message : 'Failed deleting some audio objects';
        console.warn('Failed clearing some TTS segment audio objects:', {
          documentId: parsed.documentId,
          userId: scope.storageUserId,
          error: warning,
        });
      }
    }

    return NextResponse.json({
      documentId: parsed.documentId,
      deletedSegments: rows.length,
      deletedAudioObjects,
      ...(warning ? { warning } : {}),
    });
  } catch (error) {
    console.error('Error clearing TTS segment cache:', error);
    return NextResponse.json({ error: 'Failed to clear TTS segment cache' }, { status: 500 });
  }
}
