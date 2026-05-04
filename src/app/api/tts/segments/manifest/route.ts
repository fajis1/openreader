import { NextRequest, NextResponse } from 'next/server';
import { and, asc, eq, gte, lte } from 'drizzle-orm';
import { db } from '@/db';
import { ttsSegments } from '@/db/schema';
import { isS3Configured } from '@/lib/server/storage/s3';
import { resolveSegmentDocumentScope } from '@/lib/server/tts/segments-auth';
import type { TTSSegmentManifestItem } from '@/types/client';

export const dynamic = 'force-dynamic';

function s3NotConfiguredResponse(): NextResponse {
  return NextResponse.json(
    { error: 'TTS segments storage is not configured. Set S3_* environment variables.' },
    { status: 503 },
  );
}

function parseIntOr(value: string | null, fallback: number): number {
  const n = Number.parseInt(value || '', 10);
  return Number.isFinite(n) ? n : fallback;
}

export async function GET(request: NextRequest) {
  try {
    if (!isS3Configured()) return s3NotConfiguredResponse();

    const documentId = (request.nextUrl.searchParams.get('documentId') || '').trim().toLowerCase();
    const settingsHash = (request.nextUrl.searchParams.get('settingsHash') || '').trim();
    if (!documentId || !settingsHash) {
      return NextResponse.json({ error: 'Missing documentId or settingsHash' }, { status: 400 });
    }

    const scope = await resolveSegmentDocumentScope(request, documentId);
    if (scope instanceof Response) return scope;

    const fromIndex = Math.max(0, parseIntOr(request.nextUrl.searchParams.get('fromIndex'), 0));
    const toIndex = Math.max(fromIndex, parseIntOr(request.nextUrl.searchParams.get('toIndex'), fromIndex + 8));

    const rows = (await db
      .select()
      .from(ttsSegments)
      .where(and(
        eq(ttsSegments.userId, scope.storageUserId),
        eq(ttsSegments.documentId, documentId),
        eq(ttsSegments.documentVersion, scope.documentVersion),
        eq(ttsSegments.settingsHash, settingsHash),
        gte(ttsSegments.segmentIndex, fromIndex),
        lte(ttsSegments.segmentIndex, toIndex),
      ))
      .orderBy(asc(ttsSegments.segmentIndex))) as Array<{
      segmentId: string;
      segmentIndex: number;
      locatorJson: string | null;
      durationMs: number | null;
      alignmentJson: string | null;
      status: string;
    }>;

    const segments: TTSSegmentManifestItem[] = rows.map((row) => ({
      segmentId: row.segmentId,
      segmentIndex: row.segmentIndex,
      audioUrl: row.status === 'completed'
        ? `/api/tts/segments/audio?documentId=${encodeURIComponent(documentId)}&segmentId=${encodeURIComponent(row.segmentId)}`
        : '',
      durationMs: row.durationMs ?? 0,
      alignment: row.alignmentJson ? JSON.parse(row.alignmentJson) : null,
      locator: row.locatorJson ? JSON.parse(row.locatorJson) : null,
      status: row.status === 'error' ? 'error' : row.status === 'completed' ? 'completed' : 'pending',
    }));

    return NextResponse.json({
      documentId,
      documentVersion: scope.documentVersion,
      settingsHash,
      segments,
    });
  } catch (error) {
    console.error('Error fetching TTS segment manifest:', error);
    return NextResponse.json({ error: 'Failed to fetch TTS segment manifest' }, { status: 500 });
  }
}
