import { NextResponse, NextRequest } from 'next/server';
import { db } from '@/db';
import { adminSettings } from '@/db/schema';
import { eq } from 'drizzle-orm';

const DEFAULT_SEED_PRONUNCIATIONS: Record<string, string[]> = {
  "Eather": ["/iːθər/"],
  "Yin Lime": ["/jɪn laɪm/"],
  "Eatheral": ["/iːθərəl/"],
  "Aetherian": ["/iːθərɪən/"],
  "stumbled": ["/stʌmbəld/"],
  "bottomed-out": ["/bɒtəmd aʊt/"],
  "launched": ["/lɔːntʃt/"],
  "face-planted": ["/feɪs plæntəd/"],
  "Aetherians": ["/iːθərɪən/"],
  "Avinian": ["/əvɪniən/"],
  "qŏdāšîm": ["/koʊdɑʃim/"],
  "qādôš": ["/kɑdoʊʃ/"],
  "λόγος": ["/lɒɡɒs/"],
  "καταλλάσσω": ["/kɑtɑlɑsoʊ/"],
  "בְּרִית": ["/bəɹiθ/"]
};

export async function GET() {
  try {
    const rows = await db
      .select({ valueJson: adminSettings.valueJson })
      .from(adminSettings)
      .where(eq(adminSettings.key, 'global_pronunciations'))
      .limit(1);

    let parsed: Record<string, any> = {};
    if (!rows || rows.length === 0 || !rows[0].valueJson) {
      // Seed initial global dictionary with default prepopulated pronunciations
      parsed = DEFAULT_SEED_PRONUNCIATIONS;
      await db.insert(adminSettings).values({
        key: 'global_pronunciations',
        valueJson: JSON.stringify(DEFAULT_SEED_PRONUNCIATIONS)
      }).onConflictDoUpdate({
        target: adminSettings.key,
        set: { valueJson: JSON.stringify(DEFAULT_SEED_PRONUNCIATIONS) }
      });
    } else {
      const value = rows[0].valueJson;
      parsed = typeof value === 'string' ? JSON.parse(value) : value;
      if (!parsed || Object.keys(parsed).length === 0) {
        parsed = DEFAULT_SEED_PRONUNCIATIONS;
      }
    }

    // Normalize to new object schema
    const normalized: Record<string, any[]> = {};
    for (const [key, val] of Object.entries(parsed)) {
      if (Array.isArray(val)) {
        normalized[key] = val.map((item: any) => typeof item === 'string' ? { phonetic: item, usageCount: 0 } : item).slice(0, 5);
      } else if (typeof val === 'string') {
        normalized[key] = [{ phonetic: val, usageCount: 0 }];
      }
    }

    return NextResponse.json(normalized);
  } catch (error) {
    console.error('Failed to get global pronunciations', error);
    return NextResponse.json({});
  }
}

export async function POST(req: NextRequest) {
  try {
    const { word, phonetic } = await req.json();
    if (!word || !phonetic) {
      return NextResponse.json({ error: 'Missing word or phonetic' }, { status: 400 });
    }

    const rows = await db
      .select({ valueJson: adminSettings.valueJson })
      .from(adminSettings)
      .where(eq(adminSettings.key, 'global_pronunciations'))
      .limit(1);

    let currentGlobal: Record<string, any[]> = {};
    if (rows && rows.length > 0 && rows[0].valueJson) {
      try {
        const parsed = typeof rows[0].valueJson === 'string' ? JSON.parse(rows[0].valueJson) : rows[0].valueJson;
        for (const [key, val] of Object.entries(parsed)) {
          if (Array.isArray(val)) {
            currentGlobal[key] = val.map((item: any) => typeof item === 'string' ? { phonetic: item, usageCount: 0 } : item);
          } else if (typeof val === 'string') {
            currentGlobal[key] = [{ phonetic: val, usageCount: 0 }];
          }
        }
      } catch (e) {
        // Ignore parse error
      }
    }

    let existingList = currentGlobal[word] || [];
    
    // Check if the phonetic already exists
    const existingIndex = existingList.findIndex((p: any) => p.phonetic === phonetic);
    if (existingIndex !== -1) {
      // Increment usage count
      existingList[existingIndex].usageCount = (existingList[existingIndex].usageCount || 0) + 1;
    } else {
      // It's a new pronunciation
      const newItem = { phonetic, usageCount: 1, isUserCustom: true, timestamp: Date.now() };
      if (existingList.length < 5) {
        existingList.push(newItem);
      } else {
        // Replace least used
        let minUsageIndex = 0;
        let minUsage = existingList[0].usageCount || 0;
        for (let i = 1; i < existingList.length; i++) {
          const usage = existingList[i].usageCount || 0;
          if (usage < minUsage) {
            minUsage = usage;
            minUsageIndex = i;
          }
        }
        existingList[minUsageIndex] = newItem;
      }
    }

    currentGlobal[word] = existingList;

    await db.insert(adminSettings).values({
      key: 'global_pronunciations',
      valueJson: JSON.stringify(currentGlobal)
    }).onConflictDoUpdate({
      target: adminSettings.key,
      set: { valueJson: JSON.stringify(currentGlobal) }
    });

    return NextResponse.json({ success: true, updatedList: currentGlobal[word] });
  } catch (error) {
    console.error('Failed to update global pronunciations', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
