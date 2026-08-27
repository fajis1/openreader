import { NextRequest, NextResponse } from 'next/server';
import { requireAuthContext } from '@/lib/server/auth/auth';
import { getAudiobookObjectBuffer } from '@/lib/server/audiobooks/blobstore';
import { errorResponse } from '@/lib/server/errors/next-response';

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAuthContext(request);
    if (ctx instanceof Response) return ctx;
    const userId = ctx.userId;
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const url = new URL(request.url);
    const bookId = url.searchParams.get('bookId');
    if (!bookId) return NextResponse.json({ error: 'bookId is required' }, { status: 400 });

    const runId = url.searchParams.get('runId');
    if (runId && !/^[a-zA-Z0-9_-]+$/.test(runId)) {
      return NextResponse.json({ error: 'Invalid runId' }, { status: 400 });
    }

    const changelogFileName = runId
      ? `batch_refine_${runId}.diff`
      : 'batch_refine_changelog.diff';

    try {
      const diffBuffer = await getAudiobookObjectBuffer(bookId, userId, changelogFileName, null);
      return new NextResponse(diffBuffer.toString('utf-8'), {
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      });
    } catch {
      return new NextResponse('', {
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      }); // Empty if none exists
    }
  } catch (error) {
    return errorResponse(error, {
      apiErrorMessage: 'Failed to fetch changelog',
      normalize: { code: 'BATCH_REFINE_CHANGELOG_FAILED', errorClass: 'storage' },
    });
  }
}
