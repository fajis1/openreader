import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { audiobooks } from '@/db/schema';
import { eq, inArray, and } from 'drizzle-orm';
import { requireAuthContext } from '@/lib/server/auth/auth';
import {
  listAudiobookObjects,
  getAudiobookObjectBuffer
} from '@/lib/server/audiobooks/blobstore';
import { decodeChapterFileName, encodeChapterFileName } from '@/lib/server/audiobooks/chapters';
import { generateSegmentedAudiobookTtsBuffer } from '@/lib/server/audiobooks/segmented-tts';
import { coerceAudiobookGenerationSettings } from '@/lib/server/audiobooks/settings';
import { AudiobookBlobObject, putAudiobookObject } from '@/lib/server/audiobooks/blobstore';

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
          
          const audioFileMap = new Map<number, AudiobookBlobObject>(audioFiles.map(a => {
            const decoded = decodeChapterFileName(a.fileName);
            return [decoded?.index ?? -1, a];
          }));

          let modifiedCount = 0;
          for (const txt of txtFiles) {
             const match = /^(\d{1,6})__/.exec(txt.fileName);
             if (!match) continue;
             const index = parseInt(match[1], 10) - 1;
             
             const correspondingAudio = audioFileMap.get(index);
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

    const baseUrl = `http://127.0.0.1:${process.env.PORT || 3003}`;
    const cookieHeader = request.headers.get('cookie') || '';
    
    // Run the rebuild in the background so the UI doesn't hang
    (async () => {
      let rebuildCount = 0;
      
      for (const book of booksToProcess) {
        try {
          const objects = await listAudiobookObjects(book.id, userId, null);
        const txtFiles = objects.filter(o => o.fileName.endsWith('.txt') && !o.fileName.includes('__changelog'));
        const audioFiles = objects.filter(o => o.fileName.endsWith('.mp3') || o.fileName.endsWith('.m4b'));
        
        const audioFileMap = new Map<number, AudiobookBlobObject>(audioFiles.map(a => {
          const decoded = decodeChapterFileName(a.fileName);
          return [decoded?.index ?? -1, a];
        }));

        const chaptersToRebuild = [];

        for (const txt of txtFiles) {
            const match = /^(\d{1,6})__/.exec(txt.fileName);
            if (!match) continue;
            const index = parseInt(match[1], 10) - 1;
            
            const correspondingAudio = audioFileMap.get(index);
            // If audio doesn't exist OR txt is newer than audio
            if (!correspondingAudio || txt.lastModified > correspondingAudio.lastModified) {
              chaptersToRebuild.push({
                  index: index,
                  title: `Chapter ${index + 1}`,
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
              
              let provider = 'openai';
              let voice = 'am_michael';
              let speed = 1.0;
              let model = 'kokoro-v1';
              try {
                const parsedSettings = JSON.parse(
                  (await getAudiobookObjectBuffer(book.id, userId, 'audiobook.meta.json', null)).toString('utf8')
                );
                const existingResult = coerceAudiobookGenerationSettings(parsedSettings, {
                  fallbackProviderRef: 'openai',
                });
                if (existingResult.settings) {
                  provider = existingResult.settings.provider || provider;
                  voice = existingResult.settings.voice || voice;
                  speed = existingResult.settings.speed || speed;
                  model = existingResult.settings.model || model;
                }
              } catch (e) {
                console.error(`Could not parse settings for ${book.id}, using defaults`, e);
              }
              
              const audioBuffer = await generateSegmentedAudiobookTtsBuffer(
                {
                  text,
                  format: chap.format as any,
                  voice: mergedSettings?.voice || 'am_michael',
                  speed: mergedSettings?.speed || 1.0,
                  provider,
                  apiKey: 'dummy',
                  baseUrl: provider === 'kokoro' || provider === 'openai' ? 'http://172.22.0.1:8880/v1' : undefined,
                  model: mergedSettings?.model || 'kokoro-v1',
                },
                request.signal,
                {
                  ttsCacheMaxSizeBytes: 1000000000,
                  ttsCacheTtlMs: 86400000,
                  ttsUpstreamMaxRetries: 3,
                  ttsUpstreamTimeoutMs: 120000,
                }
              );
              
              const outName = encodeChapterFileName(chap.index, chap.title, chap.format as any);
              await putAudiobookObject(book.id, userId, outName, Buffer.from(audioBuffer), chap.format === 'mp3' ? 'audio/mpeg' : 'audio/mp4');
              
              rebuildCount++;
            } catch (err) {
              console.error(`Failed to rebuild chapter ${chap.index} for book ${book.id}:`, err);
            }
        }
      } catch (e) {
          console.error(`Failed to list/rebuild objects for book ${book.id}:`, e);
      }
    }
    console.log(`Finished batch rebuild. Rebuilt ${rebuildCount} chapters.`);
    })();

    return NextResponse.json({ success: true, message: `Background batch rebuild started for ${booksToProcess.length} book(s).` });
  } catch (err: any) {
    console.error('Batch regenerate failed:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
