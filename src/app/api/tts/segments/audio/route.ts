import { NextRequest, NextResponse } from 'next/server';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { ttsSegments } from '@/db/schema';
import { isS3Configured } from '@/lib/server/storage/s3';
import { getTtsSegmentAudioObject } from '@/lib/server/tts/segments-blobstore';
import { resolveSegmentDocumentScope } from '@/lib/server/tts/segments-auth';

export const dynamic = 'force-dynamic';

function s3NotConfiguredResponse(): NextResponse {
  return NextResponse.json(
    { error: 'TTS segments storage is not configured. Set S3_* environment variables.' },
    { status: 503 },
  );
}

function streamBuffer(buffer: Buffer): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(buffer));
      controller.close();
    },
  });
}

export async function GET(request: NextRequest) {
  try {
    if (!isS3Configured()) return s3NotConfiguredResponse();

    const documentId = (request.nextUrl.searchParams.get('documentId') || '').trim().toLowerCase();
    const segmentId = (request.nextUrl.searchParams.get('segmentId') || '').trim().toLowerCase();
    if (!documentId || !segmentId) {
      return NextResponse.json({ error: 'Missing documentId or segmentId' }, { status: 400 });
    }

    const scope = await resolveSegmentDocumentScope(request, documentId);
    if (scope instanceof Response) return scope;

    const rows = (await db
      .select({
        audioKey: ttsSegments.audioKey,
        status: ttsSegments.status,
      })
      .from(ttsSegments)
      .where(and(
        eq(ttsSegments.userId, scope.storageUserId),
        eq(ttsSegments.documentId, documentId),
        eq(ttsSegments.documentVersion, scope.documentVersion),
        eq(ttsSegments.segmentId, segmentId),
      ))) as Array<{ audioKey: string | null; status: string }>;

    const row = rows[0];
    if (!row || !row.audioKey || row.status !== 'completed') {
      return NextResponse.json({ error: 'Segment audio not found' }, { status: 404 });
    }

    const audio = await getTtsSegmentAudioObject(row.audioKey);

    return new NextResponse(streamBuffer(audio), {
      headers: {
        'Content-Type': 'audio/mpeg',
        'Cache-Control': 'private, max-age=86400',
      },
    });
  } catch (error) {
    console.error('Error serving TTS segment audio:', error);
    return NextResponse.json({ error: 'Failed to load segment audio' }, { status: 500 });
  }
}
