import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { adminSettings } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { requireAuthContext } from '@/lib/server/auth/auth';
import { readSmartAudioProfilesDocument, writeSmartAudioProfilesDocument } from '@/lib/server/smart-audio-profiles';
import { readBookLexicon, writeBookLexicon } from '@/lib/server/smart-audio/book-lexicon';

export async function POST(request: NextRequest) {
  try {
    const ctxOrRes = await requireAuthContext(request);
    if (ctxOrRes instanceof Response) return ctxOrRes;
    const userId = ctxOrRes.userId;
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await request.json();
    const bookId = body.bookId;

    let removedCount = 0;

    // 1. Clean Global Pronunciations
    const globalPronunRows = await db.select().from(adminSettings).where(eq(adminSettings.key, 'global_pronunciations')).limit(1);
    if (globalPronunRows.length > 0) {
      const data = JSON.parse(globalPronunRows[0].valueJson);
      const newData: any = {};
      for (const [k, v] of Object.entries(data)) {
        if (!k.includes(' ')) newData[k] = v;
        else removedCount++;
      }
      await db.update(adminSettings).set({ valueJson: JSON.stringify(newData) }).where(eq(adminSettings.key, 'global_pronunciations'));
    }

    // 2. Clean Global Definitions
    const globalDefRows = await db.select().from(adminSettings).where(eq(adminSettings.key, 'global_definitions')).limit(1);
    if (globalDefRows.length > 0) {
      const data = JSON.parse(globalDefRows[0].valueJson);
      const newData: any = {};
      for (const [k, v] of Object.entries(data)) {
        if (!k.includes(' ')) newData[k] = v;
        else removedCount++;
      }
      await db.update(adminSettings).set({ valueJson: JSON.stringify(newData) }).where(eq(adminSettings.key, 'global_definitions'));
    }

    // 3. Clean User Profiles
    const profilesDoc = await readSmartAudioProfilesDocument(userId);
    if (profilesDoc) {
      let profilesChanged = false;
      for (const p of profilesDoc.profiles) {
        if (p.pronunciations) {
          for (const k of Object.keys(p.pronunciations)) {
            if (k.includes(' ')) {
              delete p.pronunciations[k];
              removedCount++;
              profilesChanged = true;
            }
          }
        }
      }
      if (profilesChanged) {
        await writeSmartAudioProfilesDocument(userId, profilesDoc);
      }
    }

    // 4. Clean Book Lexicon if provided
    if (bookId) {
      const lexicon = await readBookLexicon(userId, bookId);
      if (lexicon && lexicon.entries) {
        let lexiconChanged = false;
        for (const k of Object.keys(lexicon.entries)) {
          if (k.includes(' ')) {
            delete lexicon.entries[k];
            removedCount++;
            lexiconChanged = true;
          }
        }
        if (lexiconChanged) {
          await writeBookLexicon(userId, bookId, lexicon);
        }
      }
    }

    return NextResponse.json({ success: true, removedCount });
  } catch (error: any) {
    console.error(error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
