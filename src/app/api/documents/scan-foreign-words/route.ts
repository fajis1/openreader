import { NextRequest, NextResponse } from 'next/server';
import { requireAuthContext } from '@/lib/server/auth/auth';
import { serverLogger } from '@/lib/server/logger';
import { getDocumentBlob } from '@/lib/server/documents/blobstore';
import { getOpenReaderTestNamespace } from '@/lib/server/testing/test-namespace';
import { readSmartAudioProfilesDocument, findSmartAudioProfileById } from '@/lib/server/smart-audio-profiles';
import { buildKokoroPronunciationInstructions, isKokoroCompatiblePronunciation } from '@/lib/shared/kokoro-pronunciation-policy';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { execFile } from 'child_process';
import util from 'util';
import { db } from '@/db';
import { adminSettings } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { generateTTSBuffer } from '@/lib/server/tts/generate';
import { resolveTtsCredentials } from '@/lib/server/admin/resolve-credentials';
import { getResolvedRuntimeConfig } from '@/lib/server/runtime-config';

const execFileAsync = util.promisify(execFile);

export async function POST(req: NextRequest) {
  try {
    const ctxOrRes = await requireAuthContext(req);
    if (ctxOrRes instanceof Response) return ctxOrRes;
    const userId = ctxOrRes.userId;
    
    const body = await req.json();
    const documentId = body.documentId;
    if (!documentId) return NextResponse.json({ error: 'Missing documentId' }, { status: 400 });

    const mode = body.mode || 'all_foreign';
    const target = typeof body.target === 'number' ? body.target : 80.0;
    const query = body.query || null;

    const testNamespace = getOpenReaderTestNamespace(req.headers);
    const pdfBlob = await getDocumentBlob(documentId, testNamespace);

    // write to temp file
    const tempFilePath = path.join(os.tmpdir(), `scan-${documentId}-${Date.now()}.pdf`);
    await fs.writeFile(tempFilePath, pdfBlob);

    // Call python script
    let stdout;
    try {
      serverLogger.info({ event: 'pdf.scan.started', documentId, mode, target }, 'Starting PDF foreign words pre-scan Python process...');
      const pythonBin = path.join(process.cwd(), '.venv', 'bin', 'python3');
      
      const args = [
        'scan_pdf_foreign_words.py',
        tempFilePath,
        '--mode', mode,
        '--target', target.toString(),
        '--json'
      ];
      if (query) {
        args.push('--query', query);
      }

      const result = await execFileAsync(pythonBin, args, {
        cwd: process.cwd(),
        maxBuffer: 10 * 1024 * 1024
      });
      stdout = result.stdout;
      serverLogger.info({ event: 'pdf.scan.completed', documentId }, 'PDF foreign words pre-scan Python process completed');
    } finally {
      await fs.unlink(tempFilePath).catch(() => {});
    }

    const words = JSON.parse(stdout);

    // Fetch global pronunciations
    const globalRows = await db.select().from(adminSettings).where(eq(adminSettings.key, 'global_pronunciations')).limit(1);
    let globalDict: Record<string, any[]> = {};
    if (globalRows.length > 0 && globalRows[0].valueJson) {
      try {
        const parsed = typeof globalRows[0].valueJson === 'string' ? JSON.parse(globalRows[0].valueJson) : globalRows[0].valueJson;
        for (const [k, v] of Object.entries(parsed)) {
          if (Array.isArray(v)) {
            globalDict[k] = v.map((item: any) => typeof item === 'string' ? { phonetic: item, usageCount: 0 } : item);
          } else if (typeof v === 'string') {
            globalDict[k] = [{ phonetic: v, usageCount: 0 }];
          }
        }
      } catch (e) {}
    }

    const profilesDoc = await readSmartAudioProfilesDocument(userId);
    const activeProfile = findSmartAudioProfileById(profilesDoc, profilesDoc.selectedProfileId);
    
    const overrides = activeProfile?.pronunciations || {};
    const preExistingGlobalWords = new Set(Object.keys(globalDict));
    const geminiRecommendations: Record<string, string> = {};

    const wordsMissingOptions = words
      .filter((w: any) => !overrides[w.word] && (!globalDict[w.word] || globalDict[w.word].length < 5))
      .map((w: any) => w.word);

    let updatedGlobal = false;
    let newPhoneticsToCache: { word: string; phonetic: string }[] = [];

    if (wordsMissingOptions.length > 0 && activeProfile?.geminiApiKey) {
      const model = activeProfile?.aiModel || 'gemini-3.6-flash';
      const apiKey = activeProfile.geminiApiKey;
      
      const chunkSize = 20;
      for (let i = 0; i < wordsMissingOptions.length; i += chunkSize) {
        const chunk = wordsMissingOptions.slice(i, i + chunkSize);
        const prompt = `${buildKokoroPronunciationInstructions(activeProfile)}

Generate 5 distinct, plausible Kokoro IPA pronunciation variations for each of the following words: ${chunk.join(', ')}.
Provide slight variations that remain consistent with the pronunciation guidance above.
Put the single best pronunciation first for each word; that first result is the recommended choice.
Return a JSON object mapping each word to an array of 5 string pronunciations.
Example: { "word1": ["/pron1/", "/pron2/", "/pron3/", "/pron4/", "/pron5/"] }`;
        
        try {
          const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ role: "user", parts: [{ text: prompt }] }],
              generationConfig: { responseMimeType: "application/json" }
            })
          });
          const data = await res.json();
          if (data.candidates && data.candidates[0]?.content?.parts?.[0]?.text) {
            const generated = JSON.parse(data.candidates[0].content.parts[0].text);
            for (const [w, prons] of Object.entries(generated)) {
              if (Array.isArray(prons)) {
                const current = globalDict[w] || [];
                const existingPhonetics = new Set(current.map(c => c.phonetic));
                
                for (const p of prons) {
                  if (isKokoroCompatiblePronunciation(p) && !existingPhonetics.has(p) && current.length < 5) {
                    if (!geminiRecommendations[w]) geminiRecommendations[w] = p;
                    current.push({ phonetic: p, usageCount: 0, isUserCustom: false, timestamp: Date.now() });
                    existingPhonetics.add(p);
                    newPhoneticsToCache.push({ word: w, phonetic: p });
                    updatedGlobal = true;
                  }
                }
                globalDict[w] = current;
              }
            }
          }
        } catch (err) {
          console.error("Gemini API error:", err);
        }
      }
    }

    if (updatedGlobal) {
      await db.insert(adminSettings).values({
        key: 'global_pronunciations',
        valueJson: JSON.stringify(globalDict)
      }).onConflictDoUpdate({
        target: adminSettings.key,
        set: { valueJson: JSON.stringify(globalDict) }
      });
    }

    // Collect ALL pronunciations for top 80% words (both newly generated and existing) to guarantee instant playback
    const allPhoneticsToCache: { word: string; phonetic: string }[] = [];
    for (const w of words) {
      const prons = globalDict[w.word] || [];
      for (const item of prons) {
        if (item?.phonetic) {
          allPhoneticsToCache.push({ word: w.word, phonetic: item.phonetic });
        }
      }
    }

    if (allPhoneticsToCache.length > 0) {
      try {
        const runtimeConfig = await getResolvedRuntimeConfig();
        const creds = await resolveTtsCredentials({
          providerHeader: null,
          apiKeyHeader: null,
          baseUrlHeader: null,
          fallbackProvider: runtimeConfig.defaultTtsProvider || 'custom-openai',
          restrictUserApiKeys: runtimeConfig.restrictUserApiKeys ?? false,
        });

        if (!('error' in creds)) {
          // Pre-cache in the background to avoid blocking the HTTP response and crashing the route
          (async () => {
            const batchSize = 10;
            for (let i = 0; i < allPhoneticsToCache.length; i += batchSize) {
              const batch = allPhoneticsToCache.slice(i, i + batchSize);
              const cachePromises = batch.map(({ word, phonetic }) => {
                const textToSynthesize = phonetic.startsWith('/') ? `[${word}](${phonetic})` : `[${word}](/${phonetic}/)`;
                return generateTTSBuffer({
                  text: textToSynthesize,
                  voice: 'af_heart',
                  speed: 1,
                  format: 'mp3',
                  provider: creds.provider,
                  apiKey: creds.apiKey,
                  baseUrl: creds.baseUrl,
                }).catch(e => console.error('Failed to pre-cache', word, e?.message || e));
              });
              await Promise.all(cachePromises);
            }
          })().catch(e => console.error('Background pre-caching error:', e));
        }
      } catch (e) {
        console.error('Error in pre-caching audio', e);
      }
    }

    const enriched = words.map((w: any) => {
      const userPronunciation = overrides[w.word] || null;
      const globalPronunciation = preExistingGlobalWords.has(w.word)
        ? globalDict[w.word]?.[0]?.phonetic || null
        : null;
      const libraryPronunciation = userPronunciation || globalPronunciation;

      return {
        ...w,
        pronunciations: globalDict[w.word] || [],
        userOverride: userPronunciation,
        libraryPronunciation,
        pronunciationSource: userPronunciation ? 'personal' : globalPronunciation ? 'global' : geminiRecommendations[w.word] ? 'gemini' : 'none',
        geminiRecommendedPronunciation: geminiRecommendations[w.word] || null,
      };
    });

    return NextResponse.json({ words: enriched });
  } catch (error: any) {
    serverLogger.error({ event: 'pdf.scan.failed', error }, 'Scan foreign words error');
    console.error('Scan foreign words error:', error);
    return NextResponse.json({ error: error?.message || 'Failed to scan document' }, { status: 500 });
  }
}
