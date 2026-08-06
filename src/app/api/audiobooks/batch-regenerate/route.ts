import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { audiobooks } from '@/db/schema';
import { eq, inArray, and } from 'drizzle-orm';
import { requireAuthContext } from '@/lib/server/auth/auth';
import {
  listAudiobookObjects,
  getAudiobookObjectBuffer
} from '@/lib/server/audiobooks/blobstore';
import { decodeChapterFileName } from '@/lib/server/audiobooks/chapters';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireAuthContext(request);
    if (ctx instanceof Response) return ctx;
    
    const userId = ctx.userId;
    if (!userId) return new Response("Unauthorized", { status: 401 });
    const body = await request.json().catch(() => ({}));
    const { bookId, bookIds, dryRun } = body;

    let booksToProcess: { id: string, name?: string | null }[] = [];
    if (bookIds && Array.isArray(bookIds) && bookIds.length > 0) {
      booksToProcess = (await db.select({ id: audiobooks.id, title: audiobooks.title })
                               .from(audiobooks)
                               .where(and(eq(audiobooks.userId, userId), inArray(audiobooks.id, bookIds)))).map((b: any) => ({ id: b.id, name: b.title }));
    } else if (bookId) {
      booksToProcess = (await db.select({ id: audiobooks.id, title: audiobooks.title })
                               .from(audiobooks)
                               .where(and(eq(audiobooks.userId, userId), eq(audiobooks.id, bookId)))).map((b: any) => ({ id: b.id, name: b.title }));
    } else {
      booksToProcess = (await db.select({ id: audiobooks.id, title: audiobooks.title })
                               .from(audiobooks)
                               .where(eq(audiobooks.userId, userId))).map((b: any) => ({ id: b.id, name: b.title }));
    }

    if (dryRun) {
      const results = [];
      for (const book of booksToProcess) {
        try {
          const objects = await listAudiobookObjects(book.id, userId, null);
          const txtFiles = objects.filter(o => o.fileName.endsWith('.txt') && !o.fileName.includes('__changelog'));
          const audioFiles = objects.filter(o => o.fileName.endsWith('.mp3') || o.fileName.endsWith('.m4b'));
          
          const audioFileMap = new Map(audioFiles.map(a => {
            const decoded = decodeChapterFileName(a.fileName);
            return [decoded?.index ?? -1, a];
          }));

          let modifiedCount = 0;
          for (const txt of txtFiles) {
             const decoded = decodeChapterFileName(txt.fileName);
             if (!decoded) continue;
             
             const correspondingAudio = audioFileMap.get(decoded.index);
             if (!correspondingAudio || txt.lastModified > correspondingAudio.lastModified) {
                modifiedCount++;
             }
          }
          if (modifiedCount > 0) {
            results.push({ bookId: book.id, bookName: book.name || 'Unknown Book', modifiedChunks: modifiedCount });
          }
        } catch (e) {
          console.error('Error scanning book for dry run', book.id, e);
        }
      }
      return NextResponse.json({ success: true, needsRegeneration: results });
    }

    const host = request.headers.get('host');
    const protocol = request.nextUrl.protocol || 'http:';
    const baseUrl = `${protocol}//${host}`;
    const cookieHeader = request.headers.get('cookie') || '';
    
    // Background execution
    (async () => {
      let rebuildCount = 0;
      
      for (const book of booksToProcess) {
        try {
          const objects = await listAudiobookObjects(book.id, userId, null);
          const txtFiles = objects.filter(o => o.fileName.endsWith('.txt') && !o.fileName.includes('__changelog'));
          const audioFiles = objects.filter(o => o.fileName.endsWith('.mp3') || o.fileName.endsWith('.m4b'));
          
          const audioFileMap = new Map(audioFiles.map(a => {
            const decoded = decodeChapterFileName(a.fileName);
            return [decoded?.index ?? -1, a];
          }));

          const chaptersToRebuild = [];

          for (const txt of txtFiles) {
             const decoded = decodeChapterFileName(txt.fileName);
             if (!decoded) continue;
             
             const correspondingAudio = audioFileMap.get(decoded.index);
             // If audio doesn't exist OR txt is newer than audio
             if (!correspondingAudio || txt.lastModified > correspondingAudio.lastModified) {
                chaptersToRebuild.push({
                   index: decoded.index,
                   title: decoded.title,
                   format: correspondingAudio ? (correspondingAudio.fileName.endsWith('.m4b') ? 'm4b' : 'mp3') : 'mp3',
                   txtFileName: txt.fileName
                });
             }
          }

          // Rebuild sequentially to not overload TTS/memory
          for (const chap of chaptersToRebuild) {
             try {
                const buf = await getAudiobookObjectBuffer(book.id, userId, chap.txtFileName, null);
                const text = buf.toString('utf-8');
                
                await fetch(`${baseUrl}/api/audiobook/chapter`, {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    'Cookie': cookieHeader
                  },
                  body: JSON.stringify({
                    bookId: book.id,
                    documentId: book.id,
                    chapterIndex: chap.index,
                    chapterTitle: chap.title,
                    text,
                    useSmartAudio: false,
                    format: chap.format
                  })
                });
                rebuildCount++;
             } catch (err) {
                console.error(`Failed to rebuild chapter ${chap.index} for book ${book.id}:`, err);
             }
          }
        } catch (e) {
           console.error(`Failed to list/rebuild objects for book ${book.id}:`, e);
        }
      }
      console.log(`Finished background batch rebuild. Rebuilt ${rebuildCount} chapters.`);
    })().catch(console.error);

    return NextResponse.json({ success: true, message: 'Background rebuild started for modified chunks.' });
  } catch (err: any) {
    console.error('Batch regenerate failed:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
