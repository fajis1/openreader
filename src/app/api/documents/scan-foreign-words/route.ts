import { after, NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { requireAuthContext } from '@/lib/server/auth/auth';
import { serverLogger } from '@/lib/server/logger';
import { getDocumentBlob } from '@/lib/server/documents/blobstore';
import { getOpenReaderTestNamespace } from '@/lib/server/testing/test-namespace';
import { readSmartAudioProfilesDocument, findSmartAudioProfileById } from '@/lib/server/smart-audio-profiles';
import { buildKokoroPronunciationInstructions, isKokoroCompatiblePronunciation } from '@/lib/shared/kokoro-pronunciation-policy';
import { resolvePronunciationAiModel } from '@/lib/shared/smart-audio-models';
import {
  isCompleteScholarScanScope,
  readBookLexicon,
  writeBookLexicon,
} from '@/lib/server/smart-audio/book-lexicon';
import type {
  SmartAudioBookLexicon,
  SmartAudioBookLexiconEntry,
} from '@/types/document-settings';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { execFile } from 'child_process';
import util from 'util';
import { db } from '@/db';
import { adminSettings } from '@/db/schema';
import { eq, sql } from 'drizzle-orm';
import { generateTTSBuffer } from '@/lib/server/tts/generate';
import { resolveTtsCredentials } from '@/lib/server/admin/resolve-credentials';
import { getResolvedRuntimeConfig } from '@/lib/server/runtime-config';
import { normalizeGeminiTokenUsage } from '@/lib/server/smart-audio/gemini-usage';
import { fetchGeminiWithRateLimitFallback } from '@/lib/server/smart-audio/gemini-failover';

const execFileAsync = util.promisify(execFile);
const GREEK = /[\u0370-\u03ff\u1f00-\u1fff]/u;
const HEBREW = /[\u0590-\u05ff]/u;

function languageForTerm(term: string): SmartAudioBookLexiconEntry['language'] {
  if (HEBREW.test(term)) return 'biblical_hebrew';
  if (GREEK.test(term)) return 'koine_greek';
  return 'other';
}

function normalizeDefinition(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  return value.trim().split(/\s+/).slice(0, 4).join(' ');
}

export async function POST(req: NextRequest) {
  try {
    const ctxOrRes = await requireAuthContext(req);
    if (ctxOrRes instanceof Response) return ctxOrRes;
    const userId = ctxOrRes.userId;
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    
    const body = await req.json();
    const documentId = typeof body.documentId === 'string' ? body.documentId : '';
    if (!documentId) return NextResponse.json({ error: 'Missing documentId' }, { status: 400 });

    const mode = body.mode || 'all_foreign';
    const target = typeof body.target === 'number' ? body.target : 80.0;
    const query = body.query || null;
    const generateOnlyForNewWords = body.generateOnlyForNewWords !== false;
    const forceUseBackupKey = body.forceUseBackupKey === true;

    const jobId = randomUUID();
    const jobKey = `foreign_word_scan:${jobId}`;

    const initialJobState = {
      id: jobId,
      userId,
      status: 'queued',
      stage: 'extracting',
      words: [],
      total: 0,
      completed: 0,
      errors: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    await db.insert(adminSettings).values({
      key: jobKey,
      valueJson: JSON.stringify(initialJobState),
    }).onConflictDoUpdate({
      target: adminSettings.key,
      set: { valueJson: JSON.stringify(initialJobState) },
    });

    after(async () => {
      const jobState: Record<string, unknown> = { ...initialJobState };
      const saveJob = async (patch: Record<string, unknown>) => {
        Object.assign(jobState, patch, { updatedAt: Date.now() });
        await db.insert(adminSettings).values({
          key: jobKey,
          valueJson: JSON.stringify(jobState),
        }).onConflictDoUpdate({
          target: adminSettings.key,
          set: { valueJson: JSON.stringify(jobState) },
        });
      };

      try {
        await saveJob({ status: 'running', stage: 'extracting' });
        const testNamespace = getOpenReaderTestNamespace(req.headers);
        const pdfBlob = await getDocumentBlob(documentId, testNamespace);

        // write to temp file
        const tempFilePath = path.join(os.tmpdir(), `scan-${documentId}-${Date.now()}.pdf`);
        await fs.writeFile(tempFilePath, pdfBlob);

        // Call python script
        let stdout: string;
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
        const compatibleOverrides = Object.fromEntries(
          Object.entries(overrides).filter(([, pronunciation]) => (
            isKokoroCompatiblePronunciation(pronunciation)
          )),
        );
        const preExistingGlobalWords = new Set(Object.keys(globalDict));
        const preExistingCompatibleGlobalPhonetics = new Map(
          Object.entries(globalDict).map(([word, choices]) => [
            word,
            new Set(
              choices
                .map((choice) => choice?.phonetic)
                .filter((pronunciation): pronunciation is string => (
                  isKokoroCompatiblePronunciation(pronunciation)
                )),
            ),
          ]),
        );
        const preExistingCompatibleGlobalWords = new Set(
          [...preExistingCompatibleGlobalPhonetics.entries()]
            .filter(([, pronunciations]) => pronunciations.size > 0)
            .map(([word]) => word),
        );
        const geminiRecommendations: Record<string, string> = {};
        const existingLexicon = await readBookLexicon(userId, documentId);
        const lexiconEntries: Record<string, SmartAudioBookLexiconEntry> = {
          ...(activeProfile && existingLexicon?.profileId === activeProfile.id ? existingLexicon.entries : {}),
        };
        for (const w of words) {
          const term = w.word;
          if (!term || typeof term !== 'string') continue;
          const userPron = compatibleOverrides[term] || null;
          const globalPron = preExistingCompatibleGlobalWords.has(term)
            ? globalDict[term]
              ?.map((choice) => choice?.phonetic)
              .find((pronunciation) => isKokoroCompatiblePronunciation(pronunciation)) || null
            : null;
          const libraryPron = userPron || globalPron;
          if (libraryPron && !lexiconEntries[term]) {
            lexiconEntries[term] = {
              term,
              pronunciation: libraryPron,
              definition: null,
              language: languageForTerm(term),
              context: Array.isArray(w.contexts) ? w.contexts[0] : undefined,
            };
          }
        }
        const needsScholarDefinition = activeProfile?.workerMode === 'scholar';

        const wordsMissingOptions = words
          .filter((w: any) => {
            const compatibleGlobalChoices = (globalDict[w.word] || []).filter((choice) => (
              isKokoroCompatiblePronunciation(choice?.phonetic)
            ));
            const needsPronunciations = !compatibleOverrides[w.word]
              && (compatibleGlobalChoices.length === 0
                || (!generateOnlyForNewWords && compatibleGlobalChoices.length < 5));
            const language = languageForTerm(w.word);
            const lexiconEntry = lexiconEntries[w.word];
            const needsDefinition = needsScholarDefinition
              && language !== 'other'
              && (!lexiconEntry || (lexiconEntry.language !== 'other' && !lexiconEntry.definition));
            return needsPronunciations || needsDefinition;
          })
          .map((w: any) => w.word);

        const enrichWords = () => words.map((w: any) => {
          const userPronunciation = compatibleOverrides[w.word] || null;
          const globalPronunciation = preExistingCompatibleGlobalWords.has(w.word)
            ? globalDict[w.word]
              ?.map((choice) => choice?.phonetic)
              .find((pronunciation) => isKokoroCompatiblePronunciation(pronunciation)) || null
            : null;
          const libraryPronunciation = userPronunciation || globalPronunciation;
          const globalChoices = (globalDict[w.word] || []).map((item: any) => ({
            ...(typeof item === 'string' ? { phonetic: item } : item),
            isInGlobalLibrary: preExistingCompatibleGlobalPhonetics
              .get(w.word)
              ?.has(item?.phonetic) === true,
          }));

          return {
            ...w,
            pronunciations: generateOnlyForNewWords && preExistingGlobalWords.has(w.word)
              ? globalChoices.slice(0, 1)
              : globalChoices,
            userOverride: userPronunciation,
            libraryPronunciation,
            pronunciationSource: userPronunciation ? 'personal' : globalPronunciation ? 'global' : geminiRecommendations[w.word] ? 'gemini' : 'none',
            geminiRecommendedPronunciation: geminiRecommendations[w.word] || null,
            definition: lexiconEntries[w.word]?.definition || null,
            definitionNeedsReview: lexiconEntries[w.word]?.needsReview === true,
          };
        });

        const globalDictAtScanStart = JSON.parse(JSON.stringify(globalDict)) as Record<string, any[]>;
        await saveJob({
          stage: 'generating',
          words: enrichWords(),
          total: wordsMissingOptions.length,
          completed: 0,
        });

        const updatedGlobalWords = new Set<string>();
        let acceptedChoices = 0;
        let updatedLexicon = false;

        if (wordsMissingOptions.length > 0) {
          if (!activeProfile?.geminiApiKey && !activeProfile?.backupGeminiApiKey) {
            throw new Error('Gemini API key is not configured for the selected Smart Audio profile.');
          }
          const model = resolvePronunciationAiModel(activeProfile);
          const apiKey = (forceUseBackupKey && activeProfile?.backupGeminiApiKey)
            ? activeProfile.backupGeminiApiKey
            : (activeProfile?.geminiApiKey || activeProfile?.backupGeminiApiKey || '');
      
      const chunkSize = 35;
      for (let i = 0; i < wordsMissingOptions.length; i += chunkSize) {
        if (i > 0) {
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
        const chunk = wordsMissingOptions.slice(i, i + chunkSize);
        const terms = chunk.map((word: string) => {
          const scanned = words.find((item: any) => item.word === word);
          const storedPronunciation = compatibleOverrides[word]
            || (globalDict[word] || [])
              .map((choice) => choice?.phonetic)
              .find((choice) => isKokoroCompatiblePronunciation(choice));
          return {
            term: word,
            contexts: Array.isArray(scanned?.contexts) ? scanned.contexts.slice(0, 2) : [],
            currentPronunciation: storedPronunciation || null,
          };
        });
        const prompt = `${buildKokoroPronunciationInstructions(activeProfile)}

Create pronunciation choices and short audiobook definitions for these terms.
For each term without currentPronunciation, return 5 distinct, plausible Kokoro IPA pronunciation variations and put the best first.
If currentPronunciation is supplied, preserve it exactly and return it as the only pronunciation; do not generate extra variations.
For Koine Greek or Biblical Hebrew, use the supplied contexts to return a contextual English definition of one to four words.
If the surrounding book context already states the definition, return that same concise gloss; OpenReader will recognize the author-supplied definition and will not speak it twice.
Set language to "koine_greek", "biblical_hebrew", or "other". For other languages, abbreviations, or invented names, set language to "other" and definition to null.
Return a JSON object keyed by the exact term.

Terms:
${JSON.stringify(terms)}`;
        
        try {
          const { response: res, usedBackup } = await fetchGeminiWithRateLimitFallback({
            primaryApiKey: apiKey,
            backupApiKey: activeProfile?.backupGeminiApiKey,
            onStatusUpdate: async (statusMessage) => {
              await saveJob({ statusMessage });
            },
            request: (requestApiKey) => fetch(
              `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(requestApiKey)}`,
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  contents: [{ role: 'user', parts: [{ text: prompt }] }],
                  generationConfig: {
                    responseMimeType: 'application/json',
                    maxOutputTokens: 8192,
                    responseSchema: {
                      type: 'OBJECT',
                      additionalProperties: {
                        type: 'OBJECT',
                        properties: {
                          language: { type: 'STRING' },
                          pronunciations: {
                            type: 'ARRAY',
                            items: { type: 'STRING' },
                          },
                          definition: { type: 'STRING' },
                          confidence: { type: 'NUMBER' },
                          needsReview: { type: 'BOOLEAN' },
                        },
                        required: ['language', 'pronunciations'],
                      },
                    },
                  },
                }),
              },
            ),
          });
          await saveJob({ statusMessage: null });
          const data = await res.json().catch(() => null);
          serverLogger.info({
            event: 'pdf.scan.gemini.usage',
            jobId,
            documentId,
            model,
            usedBackup,
            pass: 'pronunciation_definition_scan',
            batch: i / chunkSize + 1,
            tokens: normalizeGeminiTokenUsage(data?.usageMetadata),
          }, 'Recorded Gemini pronunciation and definition scan token usage.');
          if (!res.ok) {
            throw new Error(`Gemini request failed (HTTP ${res.status}).`);
          }
          const generatedText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
          if (!generatedText) {
            throw new Error('Gemini returned no pronunciation choices.');
          }
          let generated: Record<string, unknown> = {};
          try {
            generated = JSON.parse(generatedText);
          } catch (jsonErr) {
            // Partial JSON recovery: find last valid key/value entry in truncated JSON
            const lastValidIndex = Math.max(generatedText.lastIndexOf('},'), generatedText.lastIndexOf('}'));
            if (lastValidIndex > 10) {
              const sanitizedText = generatedText.slice(0, lastValidIndex + 1) + '}';
              try {
                generated = JSON.parse(sanitizedText);
                serverLogger.warn(
                  { event: 'pdf.scan.gemini.json_repaired', jobId, batch: i / chunkSize + 1 },
                  'Recovered partial JSON response from truncated Gemini output',
                );
              } catch {
                throw jsonErr;
              }
            } else {
              throw jsonErr;
            }
          }
          const acceptedWords = new Set<string>();
          for (const [w, rawResult] of Object.entries(generated)) {
            if (chunk.includes(w)) {
              const result = rawResult && typeof rawResult === 'object' && !Array.isArray(rawResult)
                ? rawResult as Record<string, unknown>
                : { pronunciations: rawResult };
              const prons = Array.isArray(result.pronunciations) ? result.pronunciations : [];
              const current = (globalDict[w] || []).filter((choice) => (
                isKokoroCompatiblePronunciation(choice?.phonetic)
              ));
              const existingPhonetics = new Set(current.map(c => c.phonetic));

              for (const p of prons) {
                if (
                  !compatibleOverrides[w]
                  && isKokoroCompatiblePronunciation(p)
                  && !existingPhonetics.has(p)
                  && current.length < 5
                ) {
                  if (!geminiRecommendations[w]) geminiRecommendations[w] = p;
                  current.push({ phonetic: p, usageCount: 0, isUserCustom: false, timestamp: Date.now() });
                  existingPhonetics.add(p);
                  acceptedChoices += 1;
                  acceptedWords.add(w);
                  updatedGlobalWords.add(w);
                }
              }
              globalDict[w] = current;

              const pronunciation = compatibleOverrides[w]
                || current[0]?.phonetic
                || prons.find((candidate) => isKokoroCompatiblePronunciation(candidate));
              if (pronunciation) {
                if (!geminiRecommendations[w] && !compatibleOverrides[w] && !preExistingCompatibleGlobalWords.has(w)) {
                  geminiRecommendations[w] = pronunciation;
                }
                const scanned = words.find((item: any) => item.word === w);
                const definition = normalizeDefinition(result.definition);
                const language = result.language === 'other'
                  ? 'other'
                  : result.language === 'biblical_hebrew'
                    ? 'biblical_hebrew'
                    : result.language === 'koine_greek'
                      ? 'koine_greek'
                      : languageForTerm(w);
                lexiconEntries[w] = {
                  term: w,
                  pronunciation,
                  definition,
                  language,
                  context: Array.isArray(scanned?.contexts) ? scanned.contexts[0] : undefined,
                  confidence: typeof result.confidence === 'number'
                    ? Math.max(0, Math.min(1, result.confidence))
                    : undefined,
                  needsReview: result.needsReview === true
                    || (needsScholarDefinition && language !== 'other' && !definition),
                };
                updatedLexicon = true;
                acceptedWords.add(w);
              }
            }
          }
          if (updatedLexicon && activeProfile) {
            const partialLexicon: SmartAudioBookLexicon = {
              schemaVersion: 1,
              status: 'partial',
              definitionScanComplete: false,
              profileId: activeProfile.id,
              pronunciationModel: model,
              scannedAt: Date.now(),
              entries: lexiconEntries,
            };
            await writeBookLexicon(userId, documentId, partialLexicon);
          }
          if (acceptedWords.size === 0) {
            throw new Error('Gemini returned no Kokoro-compatible pronunciation choices for this batch.');
          }
          const omittedWords = chunk.filter((word: string) => !acceptedWords.has(word));
          if (omittedWords.length > 0) {
            serverLogger.warn(
              { event: 'pdf.scan.gemini.omitted_words', omittedWords, jobId, batch: i / chunkSize + 1 },
              `Gemini omitted ${omittedWords.length} terms from batch ${i / chunkSize + 1}`,
            );
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Unknown Gemini error';
          serverLogger.error({ event: 'pdf.scan.gemini.batch.failed', error: err, jobId, batch: i / chunkSize + 1 }, 'Gemini pronunciation batch failed');
          const errors = Array.isArray(jobState.errors) ? [...jobState.errors, `Gemini batch ${i / chunkSize + 1}: ${message}`] : [`Gemini batch ${i / chunkSize + 1}: ${message}`];
          await saveJob({ errors, completed: Math.min(i + chunk.length, wordsMissingOptions.length) });
        }
        await saveJob({ completed: Math.min(i + chunk.length, wordsMissingOptions.length) });
      }
        }

    if (updatedGlobalWords.size > 0) {
      await db.transaction(async (tx: typeof db) => {
        if (process.env.POSTGRES_URL) {
          await tx.execute(sql`
            select pg_advisory_xact_lock(
              hashtextextended('openreader:global_pronunciations', 0)
            )
          `);
        }
        const latestRows = await tx.select()
          .from(adminSettings)
          .where(eq(adminSettings.key, 'global_pronunciations'))
          .limit(1);
        const latestDict: Record<string, any[]> = {};
        try {
          const parsed = typeof latestRows[0]?.valueJson === 'string'
            ? JSON.parse(latestRows[0].valueJson)
            : latestRows[0]?.valueJson || {};
          for (const [word, value] of Object.entries(parsed as Record<string, unknown>)) {
            if (Array.isArray(value)) {
              latestDict[word] = value.map((item: any) => (
                typeof item === 'string' ? { phonetic: item, usageCount: 0 } : item
              ));
            } else if (typeof value === 'string') {
              latestDict[word] = [{ phonetic: value, usageCount: 0 }];
            } else if (
              value
              && typeof value === 'object'
              && typeof (value as { phonetic?: unknown }).phonetic === 'string'
            ) {
              latestDict[word] = [value as any];
            }
          }
        } catch (error) {
          throw new Error('Cannot safely merge generated pronunciations into the current global library.', {
            cause: error,
          });
        }
        for (const word of updatedGlobalWords) {
          if (
            JSON.stringify(latestDict[word] || [])
            === JSON.stringify(globalDictAtScanStart[word] || [])
          ) {
            latestDict[word] = globalDict[word];
          }
        }
        await tx.insert(adminSettings).values({
          key: 'global_pronunciations',
          valueJson: JSON.stringify(latestDict),
        }).onConflictDoUpdate({
          target: adminSettings.key,
          set: { valueJson: JSON.stringify(latestDict) },
        });
      });
    }

    if (activeProfile) {
      const errors = Array.isArray(jobState.errors) ? jobState.errors : [];
      const requiredDefinitionWords = needsScholarDefinition
        ? words
          .map((word: any) => word.word as string)
          .filter((word: string) => languageForTerm(word) !== 'other')
        : [];
      const definitionScanComplete = requiredDefinitionWords.every(
        (word: string) => Boolean(
          lexiconEntries[word]?.pronunciation
          && isKokoroCompatiblePronunciation(lexiconEntries[word].pronunciation),
        ),
      );
      await writeBookLexicon(userId, documentId, {
        schemaVersion: 1,
        status: errors.length === 0
          && definitionScanComplete
          && isCompleteScholarScanScope({ mode, target, query })
          ? 'complete'
          : 'partial',
        definitionScanComplete: Boolean(
          needsScholarDefinition
          && errors.length === 0
          && definitionScanComplete
          && isCompleteScholarScanScope({ mode, target, query }),
        ),
        profileId: activeProfile.id,
        pronunciationModel: resolvePronunciationAiModel(activeProfile),
        scannedAt: Date.now(),
        entries: lexiconEntries,
      });
    }

    // Warm only Gemini's newly selected defaults up front. Existing library
    // alternatives are prepared lazily after the user first listens.
    const allPhoneticsToCache: { word: string; phonetic: string }[] = Object.entries(geminiRecommendations)
      .filter(([, phonetic]) => Boolean(phonetic))
      .map(([word, phonetic]) => ({ word, phonetic }));

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

        const generated = Object.keys(geminiRecommendations).length;
        const errors = Array.isArray(jobState.errors) ? jobState.errors : [];
        await saveJob({
          status: 'completed',
          completed: wordsMissingOptions.length,
          generated,
          generatedChoices: acceptedChoices,
          error: errors.length > 0 ? `${errors.length} Gemini batch${errors.length === 1 ? '' : 'es'} failed. ${errors[0]}` : null,
          words: enrichWords(),
        });
      } catch (error) {
        serverLogger.error({ event: 'pdf.scan.pronunciations.failed', error, jobId }, 'Background foreign-word pronunciation generation failed');
        await saveJob({ status: 'failed', error: error instanceof Error ? error.message : 'Background pronunciation generation failed' }).catch(() => {});
      }
    });

    return NextResponse.json({ words: [], scanJobId: jobId, scanStatus: 'queued', scanTotal: 0 }, { status: 202 });
  } catch (error: any) {
    serverLogger.error({ event: 'pdf.scan.failed', error }, 'Scan foreign words error');
    console.error('Scan foreign words error:', error);
    return NextResponse.json({ error: error?.message || 'Failed to scan document' }, { status: 500 });
  }
}
