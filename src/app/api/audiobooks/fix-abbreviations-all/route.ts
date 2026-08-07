import { NextRequest, NextResponse } from 'next/server';
import { requireAuthContext } from '@/lib/server/auth/auth';
import { listAudiobookObjects, getAudiobookObjectBuffer, putAudiobookObject } from '@/lib/server/audiobooks/blobstore';
import { BASE_BOOKS } from '@/components/constants';
import { readSmartAudioProfilesDocument } from '@/lib/server/smart-audio-profiles';
import { getOpenReaderTestNamespace } from '@/lib/server/testing/test-namespace';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireAuthContext(request);
    if (ctx instanceof Response) return ctx;
    const userId = ctx.userId;
    if (!userId) return new Response("Unauthorized", { status: 401 });

    const body = await request.json().catch(() => ({}));
    const { bookId, smartAudioProfileId } = body;
    if (!bookId) return NextResponse.json({ error: 'Missing bookId' }, { status: 400 });

    const testNamespace = getOpenReaderTestNamespace(request.headers);
    const profilesDoc = await readSmartAudioProfilesDocument(userId);
    const profile = profilesDoc.profiles.find(p => p.id === smartAudioProfileId) || profilesDoc.profiles[0];

    // Build books map
    const booksMap: Record<string, string> = {};
    BASE_BOOKS.forEach(b => booksMap[b.key] = b.value);
    if (profile?.books) {
      Object.entries(profile.books).forEach(([k, v]) => booksMap[k] = v as string);
    }

    const objects = await listAudiobookObjects(bookId, userId, testNamespace);
    const txtFiles = objects.filter(o => o.fileName.endsWith('.txt') && !o.fileName.includes('__original') && !o.fileName.includes('__changelog'));

    let modifiedCount = 0;

    for (const txt of txtFiles) {
      const buffer = await getAudiobookObjectBuffer(bookId, userId, txt.fileName, testNamespace);
      let pt = buffer.toString('utf8');
      const originalText = pt;

      // 1. Expand books
      Object.entries(booksMap).forEach(([short, full]) => {
        const escapedShort = short.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`\\b${escapedShort}\\.?\\s+(\\d+):(\\d+)(?:[-–](\\d+))?`, 'g');
        pt = pt.replace(regex, (match, chap, vStart, vEnd) => {
          if (vEnd) return `${full} chapter ${chap} verse ${vStart} through ${vEnd}`;
          return `${full} chapter ${chap} verse ${vStart}`;
        });
      });

      // 2. vv. and v.
      pt = pt.replace(/\bvv\.\s*(\d+)/g, 'verses $1');
      pt = pt.replace(/\bv\.\s*(\d+)/g, 'verse $1');

      // 3. User abbreviations
      if (profile?.abbreviations) {
        const keys = Object.keys(profile.abbreviations).sort((a, b) => b.length - a.length);
        keys.forEach(key => {
          const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const regex = new RegExp(`(?<!\\w)${escapedKey}(?!\\w)`, 'g');
          pt = pt.replace(regex, profile.abbreviations[key]);
        });
      }

      if (pt !== originalText) {
        await putAudiobookObject(bookId, userId, txt.fileName, Buffer.from(pt, 'utf8'), 'text/plain; charset=utf-8', testNamespace);
        modifiedCount++;
      }
    }

    return NextResponse.json({ success: true, modifiedCount });
  } catch (error: any) {
    console.error("Error fixing abbreviations", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
