import { NextRequest, NextResponse } from 'next/server';
import { requireAuthContext } from '@/lib/server/auth/auth';
import { getAudiobookObjectBuffer, listAudiobookObjects } from '@/lib/server/audiobooks/blobstore';
import { getOpenReaderTestNamespace } from '@/lib/server/testing/test-namespace';
import { isS3Configured } from '@/lib/server/storage/s3';
import { db } from '@/db';
import { audiobooks } from '@/db/schema';
import { and, eq } from 'drizzle-orm';
import { errorResponse } from '@/lib/server/errors/next-response';

export const dynamic = 'force-dynamic';

function s3NotConfiguredResponse(): NextResponse {
  return NextResponse.json(
    { error: 'Audiobooks storage is not configured. Set S3_* environment variables.' },
    { status: 503 },
  );
}

export async function GET(request: NextRequest) {
  try {
    if (!isS3Configured()) return s3NotConfiguredResponse();

    const bookId = request.nextUrl.searchParams.get('bookId');
    const download = request.nextUrl.searchParams.get('download') === 'true';
    if (!bookId) {
      return NextResponse.json({ error: 'Missing bookId parameter' }, { status: 400 });
    }

    const ctxOrRes = await requireAuthContext(request);
    if (ctxOrRes instanceof Response) return ctxOrRes;
    if (!ctxOrRes.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const storageUserId = ctxOrRes.userId;
    const testNamespace = getOpenReaderTestNamespace(request.headers);

    const existingBookRows = await db
      .select({ userId: audiobooks.userId, title: audiobooks.title })
      .from(audiobooks)
      .where(and(eq(audiobooks.id, bookId), eq(audiobooks.userId, storageUserId)));
      
    if (existingBookRows.length === 0) {
      return NextResponse.json({ error: 'Book not found' }, { status: 404 });
    }
    
    const bookTitle = existingBookRows[0].title;

    const objects = await listAudiobookObjects(bookId, storageUserId, testNamespace);
    const changelogFiles = objects
      .map(o => o.fileName)
      .filter(f => f.endsWith('__changelog.txt'))
      .sort();
      
    if (changelogFiles.length === 0) {
       return new NextResponse('No changelogs available for this audiobook. Try regenerating a chapter with Smart AI turned on.', { 
         status: 404,
         headers: { 'Content-Type': 'text/plain; charset=utf-8' }
       });
    }

    let fullChangelog = `Smart AI Processing Changelog: ${bookTitle}\n`;
    fullChangelog += `===========================================================\n`;
    fullChangelog += `This file shows a unified diff of exactly how the AI modified the original text.\n`;
    fullChangelog += `Lines starting with '-' were removed. Lines starting with '+' were added by AI.\n`;
    fullChangelog += `===========================================================\n\n`;

    for (const file of changelogFiles) {
      try {
        const bytes = await getAudiobookObjectBuffer(bookId, storageUserId, file, testNamespace);
        const chapterNumber = parseInt(file.split('__')[0], 10);
        fullChangelog += `\n--- Processing Batch ${chapterNumber} ---\n`;
        const text = bytes.toString('utf8').trim();
        if (!text) {
          fullChangelog += `(No changes made by AI)\n`;
        } else {
          fullChangelog += `${text}\n`;
        }
        fullChangelog += `\n`;
      } catch {
        fullChangelog += `\n[Failed to load changelog for batch ${file}]\n\n`;
      }
    }

    const headers: Record<string, string> = {
      'Content-Type': 'text/plain; charset=utf-8',
    };
    
    if (download) {
      headers['Content-Disposition'] = `attachment; filename="ai_changelog_${bookId.slice(0, 8)}.txt"`;
    } else {
      headers['Content-Disposition'] = `inline`;
    }

    return new NextResponse(fullChangelog, { headers });
  } catch (error) {
    return errorResponse(error, {
      apiErrorMessage: 'Failed to build changelog',
      normalize: { code: 'AUDIOBOOK_CHANGELOG_FAILED', errorClass: 'upstream' },
    });
  }
}
