import { NextRequest, NextResponse } from 'next/server';
import { requireAuthContext } from '@/lib/server/auth/auth';
import { getAudiobookObjectBuffer } from '@/lib/server/audiobooks/blobstore';

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAuthContext(request);
    if (ctx instanceof Response) return ctx;
    const userId = ctx.userId;
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const url = new URL(request.url);
    const bookId = url.searchParams.get('bookId');
    if (!bookId) return NextResponse.json({ error: 'bookId is required' }, { status: 400 });

    try {
      const diffBuffer = await getAudiobookObjectBuffer(bookId, userId, 'batch_refine_changelog.diff', null);
      return new NextResponse(diffBuffer.toString('utf-8'), {
        headers: { 'Content-Type': 'text/plain' },
      });
    } catch (e) {
      return new NextResponse('', { headers: { 'Content-Type': 'text/plain' } }); // Empty if none exists
    }
  } catch (e) {
    return NextResponse.json({ error: 'Failed to fetch changelog' }, { status: 500 });
  }
}
