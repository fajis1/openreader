import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { adminSettings } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { requireAuthContext } from '@/lib/server/auth/auth';
import { readSmartAudioProfilesDocument, writeSmartAudioProfilesDocument } from '@/lib/server/smart-audio-profiles';
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';

export const dynamic = 'force-dynamic';

const PRONUNC_FILE = path.join(process.cwd(), 'src/lib/server/default_global_pronunciations.json');
const DEFS_FILE = path.join(process.cwd(), 'src/lib/server/default_global_definitions.json');

async function safeReadFile(filepath: string) {
  try {
    return await fs.readFile(filepath, 'utf8');
  } catch (e) {
    return '{}';
  }
}

function computeHash(content1: string, content2: string) {
  return crypto.createHash('sha256').update(content1).update(content2).digest('hex');
}

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAuthContext(request);
    if (ctx instanceof Response) return ctx;
    
    const isAdmin = ctx.user?.isAdmin === true;
    const userId = ctx.userId;

    const [gitPronuncRaw, gitDefsRaw] = await Promise.all([
      safeReadFile(PRONUNC_FILE),
      safeReadFile(DEFS_FILE)
    ]);
    
    const gitHash = computeHash(gitPronuncRaw, gitDefsRaw);

    // Read Global DB
    const globalRows = await db.select().from(adminSettings).where(eq(adminSettings.key, 'global_pronunciations')).limit(1);
    let globalDict: Record<string, any> = {};
    if (globalRows.length > 0 && globalRows[0].valueJson) {
      globalDict = typeof globalRows[0].valueJson === 'string' ? JSON.parse(globalRows[0].valueJson) : globalRows[0].valueJson;
    }

    const defsRows = await db.select().from(adminSettings).where(eq(adminSettings.key, 'global_definitions')).limit(1);
    let globalDefs: Record<string, any> = {};
    if (defsRows.length > 0 && defsRows[0].valueJson) {
      globalDefs = typeof defsRows[0].valueJson === 'string' ? JSON.parse(defsRows[0].valueJson) : defsRows[0].valueJson;
    }

    // Read User Profiles
    const profilesDoc = await readSmartAudioProfilesDocument(userId);
    const activeProfile = profilesDoc.profiles.find(p => p.id === profilesDoc.selectedProfileId) || profilesDoc.profiles[0];
    
    // Check if we should prompt
    if (isAdmin) {
      const hashRow = await db.select().from(adminSettings).where(eq(adminSettings.key, 'resolved_dictionary_hash')).limit(1);
      const lastHash = hashRow.length > 0 ? (typeof hashRow[0].valueJson === 'string' ? JSON.parse(hashRow[0].valueJson) : hashRow[0].valueJson) : null;
      if (lastHash === gitHash) {
        return NextResponse.json({ hasUpdates: false });
      }
    } else {
      const lastHash = activeProfile?.resolvedDictionaryHash || null;
      if (lastHash === gitHash) {
        return NextResponse.json({ hasUpdates: false });
      }
    }

    const gitPronunc = JSON.parse(gitPronuncRaw || '{}');
    const gitDefs = JSON.parse(gitDefsRaw || '{}');

    const updates: any[] = [];

    // Compare Git Pronunciations vs Global DB
    for (const [word, gitVals] of Object.entries(gitPronunc)) {
      const gitPhonetic = Array.isArray(gitVals) ? gitVals[0]?.phonetic || (gitVals[0] as any) : (typeof gitVals === 'string' ? gitVals : '');
      const localVals = globalDict[word];
      const localPhonetic = localVals ? (Array.isArray(localVals) ? localVals[0]?.phonetic || localVals[0] : (typeof localVals === 'string' ? localVals : '')) : null;
      
      if (!localPhonetic) {
        updates.push({ word, type: 'pronunciation', status: 'new', git: gitPhonetic, local: null });
      } else if (localPhonetic !== gitPhonetic) {
        updates.push({ word, type: 'pronunciation', status: 'conflict', git: gitPhonetic, local: localPhonetic });
      }
    }

    // Compare Git Definitions vs Global DB
    for (const [word, gitDef] of Object.entries(gitDefs)) {
      const localDef = globalDefs[word];
      if (!localDef) {
        updates.push({ word, type: 'definition', status: 'new', git: gitDef, local: null });
      } else if (localDef !== gitDef) {
        updates.push({ word, type: 'definition', status: 'conflict', git: gitDef, local: localDef });
      }
    }

    if (updates.length === 0) {
      // If there are no diffs, we can auto-resolve for this user since the DB is already up to date with Git.
      if (isAdmin) {
        await db.insert(adminSettings).values({ key: 'resolved_dictionary_hash', valueJson: JSON.stringify(gitHash), source: 'system' })
          .onConflictDoUpdate({ target: adminSettings.key, set: { valueJson: JSON.stringify(gitHash) } });
      } else if (activeProfile) {
        activeProfile.resolvedDictionaryHash = gitHash;
        await writeSmartAudioProfilesDocument(userId, profilesDoc);
      }
      return NextResponse.json({ hasUpdates: false });
    }

    return NextResponse.json({ 
      hasUpdates: true, 
      hash: gitHash, 
      isAdmin, 
      updates 
    });

  } catch (err: any) {
    console.error('Dictionary update diff failed:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const ctx = await requireAuthContext(request);
    if (ctx instanceof Response) return ctx;
    
    const isAdmin = ctx.user?.isAdmin === true;
    const userId = ctx.userId;

    const { selectedPronunciations, selectedDefinitions, hash, dismissAll } = await request.json();

    if (isAdmin) {
      // Admin: Update global dictionaries and save global hash
      if (!dismissAll && (Object.keys(selectedPronunciations || {}).length > 0 || Object.keys(selectedDefinitions || {}).length > 0)) {
        const pRows = await db.select().from(adminSettings).where(eq(adminSettings.key, 'global_pronunciations')).limit(1);
        let globalDict = pRows.length > 0 && pRows[0].valueJson ? (typeof pRows[0].valueJson === 'string' ? JSON.parse(pRows[0].valueJson) : pRows[0].valueJson) : {};
        
        const dRows = await db.select().from(adminSettings).where(eq(adminSettings.key, 'global_definitions')).limit(1);
        let globalDefs = dRows.length > 0 && dRows[0].valueJson ? (typeof dRows[0].valueJson === 'string' ? JSON.parse(dRows[0].valueJson) : dRows[0].valueJson) : {};

        for (const [word, phonetic] of Object.entries(selectedPronunciations || {})) {
           globalDict[word] = [{ phonetic, usageCount: 0 }];
        }
        for (const [word, def] of Object.entries(selectedDefinitions || {})) {
           globalDefs[word] = def;
        }

        await db.insert(adminSettings).values({ key: 'global_pronunciations', valueJson: JSON.stringify(globalDict), source: 'admin' })
          .onConflictDoUpdate({ target: adminSettings.key, set: { valueJson: JSON.stringify(globalDict) } });
        
        await db.insert(adminSettings).values({ key: 'global_definitions', valueJson: JSON.stringify(globalDefs), source: 'admin' })
          .onConflictDoUpdate({ target: adminSettings.key, set: { valueJson: JSON.stringify(globalDefs) } });
      }

      await db.insert(adminSettings).values({ key: 'resolved_dictionary_hash', valueJson: JSON.stringify(hash), source: 'system' })
          .onConflictDoUpdate({ target: adminSettings.key, set: { valueJson: JSON.stringify(hash) } });

    } else {
      // User: Update personal smart audio profile and save user hash
      const profilesDoc = await readSmartAudioProfilesDocument(userId);
      const activeProfile = profilesDoc.profiles.find(p => p.id === profilesDoc.selectedProfileId) || profilesDoc.profiles[0];

      if (activeProfile) {
        if (!activeProfile.pronunciations) activeProfile.pronunciations = {};
        
        if (!dismissAll) {
          for (const [word, phonetic] of Object.entries(selectedPronunciations || {})) {
            activeProfile.pronunciations[word] = phonetic as string;
          }
        }
        
        activeProfile.resolvedDictionaryHash = hash;
        await writeSmartAudioProfilesDocument(userId, profilesDoc);
      }
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error('Dictionary update apply failed:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
