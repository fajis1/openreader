import { NextRequest, NextResponse } from 'next/server';
import { requireAuthContext } from '@/lib/server/auth/auth';
import { inferDocumentMetadataWithGemini } from '@/lib/server/audiobooks/metadata-inference';
import { getOpenReaderTestNamespace } from '@/lib/server/testing/test-namespace';
import { errorToLog, serverLogger } from '@/lib/server/logger';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const ctxOrRes = await requireAuthContext(req);
  if (ctxOrRes instanceof Response) return ctxOrRes;
  if (!ctxOrRes.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const bookId = req.nextUrl.searchParams.get('bookId');
  if (!bookId) {
    return NextResponse.json({ error: 'Missing bookId parameter' }, { status: 400 });
  }

  const namespace = getOpenReaderTestNamespace(req.headers);

  try {
    const metadata = await inferDocumentMetadataWithGemini({
      bookId,
      userId: ctxOrRes.userId,
      namespace,
    });
    return NextResponse.json({ success: true, metadata });
  } catch (error) {
    serverLogger.warn(
      { event: 'audiobook.metadata.infer_route_failed', bookId, error: errorToLog(error) },
      'Failed to infer audiobook metadata',
    );
    return NextResponse.json(
      { success: false, error: (error as Error)?.message || 'Failed to infer metadata' },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  const ctxOrRes = await requireAuthContext(req);
  if (ctxOrRes instanceof Response) return ctxOrRes;
  if (!ctxOrRes.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { bookId?: string };
  const bookId = body.bookId || req.nextUrl.searchParams.get('bookId');
  if (!bookId) {
    return NextResponse.json({ error: 'Missing bookId parameter' }, { status: 400 });
  }

  const namespace = getOpenReaderTestNamespace(req.headers);

  try {
    const metadata = await inferDocumentMetadataWithGemini({
      bookId,
      userId: ctxOrRes.userId,
      namespace,
    });
    return NextResponse.json({ success: true, metadata });
  } catch (error) {
    serverLogger.warn(
      { event: 'audiobook.metadata.infer_route_failed', bookId, error: errorToLog(error) },
      'Failed to infer audiobook metadata',
    );
    return NextResponse.json(
      { success: false, error: (error as Error)?.message || 'Failed to infer metadata' },
      { status: 500 },
    );
  }
}
