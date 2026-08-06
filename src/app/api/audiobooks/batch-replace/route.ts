import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { audiobooks } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { requireAuthContext } from '@/lib/server/auth/auth';
import {
  listAudiobookObjects,
  getAudiobookObjectBuffer,
  putAudiobookObject
} from '@/lib/server/audiobooks/blobstore';

export const dynamic = 'force-dynamic';

function escapeRegex(string: string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireAuthContext(request);
    if (ctx instanceof Response) return ctx;
    
    const userId = ctx.userId;
    if (!userId) return new Response("Unauthorized", { status: 401 });
    const { word, newPhonetic, bookId } = await request.json();

    if (!word || typeof newPhonetic !== 'string') {
      return NextResponse.json({ error: 'Missing word or newPhonetic' }, { status: 400 });
    }

    let booksToProcess: { id: string }[] = [];
    if (bookId) {
      booksToProcess = [{ id: bookId }];
    } else {
      booksToProcess = await db.select({ id: audiobooks.id }).from(audiobooks).where(eq(audiobooks.userId, userId));
    }

    let updatedCount = 0;
    const regex = new RegExp(`\\[(${escapeRegex(word)})\\]\\(\\/([^\\/]+)\\/\\)`, 'gi');

    for (const book of booksToProcess) {
      try {
        const objects = await listAudiobookObjects(book.id, userId, null);
        const textFiles = objects.filter(o => o.fileName.endsWith('.txt'));

        // Process in batches of 50 to avoid memory/file descriptor limits
        for (let i = 0; i < textFiles.length; i += 50) {
          const batch = textFiles.slice(i, i + 50);
          
          await Promise.all(batch.map(async (fileObj) => {
            try {
              const buf = await getAudiobookObjectBuffer(book.id, userId, fileObj.fileName, null);
              const text = buf.toString('utf-8');
              
              let changed = false;
              const newText = text.replace(regex, (match, p1, p2) => {
                if (p2 !== newPhonetic) {
                  changed = true;
                  return `[${p1}](/${newPhonetic}/)`;
                }
                return match;
              });

              if (changed) {
                await putAudiobookObject(book.id, userId, fileObj.fileName, Buffer.from(newText, 'utf-8'), 'text/plain', null);
                updatedCount++;
              }
            } catch (e) {
              console.error(`Failed to process file ${fileObj.fileName} in book ${book.id}:`, e);
            }
          }));
        }
      } catch (e) {
         console.error(`Failed to list objects for book ${book.id}:`, e);
      }
    }

    return NextResponse.json({ success: true, updatedCount });
  } catch (err: any) {
    console.error('Batch replace failed:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
