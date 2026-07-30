import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { audiobooks, adminSettings } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { requireAuthContext } from '@/lib/server/auth/auth';
import { readSmartAudioProfilesDocument } from '@/lib/server/smart-audio-profiles';
import { listAudiobookObjects, getAudiobookObjectBuffer } from '@/lib/server/audiobooks/blobstore';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAuthContext(request);
    if (ctx instanceof Response) return ctx;
    if (!ctx.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const userId = ctx.userId;

    const url = new URL(request.url);
    const bookId = url.searchParams.get('bookId') as string;
    const letter = url.searchParams.get('letter') || 'ALL';

    const globalRows = await db
      .select({ valueJson: adminSettings.valueJson })
      .from(adminSettings)
      .where(eq(adminSettings.key, 'global_pronunciations'))
      .limit(1);

    let globalDict: Record<string, any[]> = {};
    if (globalRows.length > 0 && globalRows[0].valueJson) {
      const val = typeof globalRows[0].valueJson === 'string' ? JSON.parse(globalRows[0].valueJson) : globalRows[0].valueJson;
      for (const [key, v] of Object.entries(val as Record<string, any>)) {
         if (Array.isArray(v)) {
           globalDict[key] = v.map((i: any) => typeof i === 'string' ? { phonetic: i } : i);
         } else if (typeof v === 'string') {
           globalDict[key] = [{ phonetic: v }];
         }
      }
    }

    const profilesDoc = await readSmartAudioProfilesDocument(userId);
    const activeProfile = profilesDoc.profiles.find(p => p.id === profilesDoc.selectedProfileId) || profilesDoc.profiles[0];
    const userPronunciations = activeProfile?.pronunciations || {};

    const allUserBooks = await db.select({ id: audiobooks.id, title: audiobooks.title }).from(audiobooks).where(eq(audiobooks.userId, userId as string));

    const wordMap: Record<string, { word: string, phonetic: string, count: number, globalChoices: string[], userOverride: string | null }> = {};

    if (bookId) {
      const objects = await listAudiobookObjects(bookId, userId, null);
      const textFiles = objects.filter(o => o.fileName.endsWith('.txt') || o.fileName.endsWith('.md') || o.fileName.endsWith('.json') || o.fileName.endsWith('.xml') || o.fileName.endsWith('.html'));

      for (const obj of textFiles) {
        try {
          const buf = await getAudiobookObjectBuffer(bookId, userId, obj.fileName, null);
          const text = buf.toString('utf-8');
          
          const regex = /\[([^\]]+)\]\(\/([^\/]+)\/\)/g;
          let match;
          while ((match = regex.exec(text)) !== null) {
            const word = match[1];
            const phonetic = match[2];
            if (!wordMap[word]) {
               wordMap[word] = {
                 word,
                 phonetic,
                 count: 0,
                 globalChoices: globalDict[word]?.map((g: any) => g.phonetic) || [],
                 userOverride: userPronunciations[word] || null
               };
            }
            wordMap[word].count++;
          }
        } catch (e) {
          console.error(`Failed to read audiobook object ${obj.fileName}:`, e);
        }
      }
    } else {
       const allWords = new Set([...Object.keys(userPronunciations), ...Object.keys(globalDict)]);
       for (const word of allWords) {
          wordMap[word] = {
            word,
            phonetic: userPronunciations[word] || (globalDict[word] ? globalDict[word][0]?.phonetic : ''),
            count: 1,
            globalChoices: globalDict[word]?.map((g: any) => g.phonetic) || [],
            userOverride: userPronunciations[word] || null
          };
       }
    }

    let wordsList = Object.values(wordMap);

    if (letter !== 'ALL') {
      if (letter === '#') {
        wordsList = wordsList.filter(w => !/^[A-Za-z]/.test(w.word));
      } else {
        wordsList = wordsList.filter(w => w.word.toUpperCase().startsWith(letter.toUpperCase()));
      }
    }

    wordsList.sort((a, b) => a.word.localeCompare(b.word));

    return NextResponse.json({
      words: wordsList,
      audiobooks: allUserBooks.map((b: any) => ({ id: b.id, name: b.name }))
    });
  } catch (error) {
    console.error('Error fetching pronunciations:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
