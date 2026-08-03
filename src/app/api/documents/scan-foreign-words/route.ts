import { after, NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { requireAuthContext } from '@/lib/server/auth/auth';
import { serverLogger } from '@/lib/server/logger';
import { getDocumentBlob } from '@/lib/server/documents/blobstore';
import { getOpenReaderTestNamespace } from '@/lib/server/testing/test-namespace';
import { readSmartAudioProfilesDocument, findSmartAudioProfileById } from '@/lib/server/smart-audio-profiles';
import { buildKokoroPronunciationInstructions, isKokoroSafePronunciation } from '@/lib/shared/kokoro-pronunciation-policy';
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
import { eq } from 'drizzle-orm';
import { generateTTSBuffer } from '@/lib/server/tts/generate';
import { resolveTtsCredentials } from '@/lib/server/admin/resolve-credentials';
import { getResolvedRuntimeConfig } from '@/lib/server/runtime-config';
import { normalizeGeminiTokenUsage } from '@/lib/server/smart-audio/gemini-usage';
import { fetchGeminiWithRateLimitFallback } from '@/lib/server/smart-audio/gemini-failover';
import { mergeGeneratedGlobalPronunciations } from '@/lib/server/smart-audio/global-pronunciation-merge';
import { mergeGlobalDefinitions, readGlobalDefinitions } from '@/lib/server/smart-audio/global-definition-library';
import {
  createGeminiHttpError,
  collectGeminiPronunciationRepairRequests,
  foreignWordCandidateCacheKey,
  GEMINI_FOREIGN_WORD_RESPONSE_JSON_SCHEMA,
  GeminiHttpError,
  mergeGeminiPronunciationRepairResults,
  isUsableForeignWordCandidate,
  parseForeignWordCandidateCache,
  parseGeminiForeignWordResults,
} from '@/lib/server/smart-audio/gemini-foreign-word-scan';
import {
  normalizeDictionaryDefinition,
  shouldOmitDictionaryDefinition,
} from '@/lib/shared/dictionary-definition-policy';

const execFileAsync = util.promisify(execFile);
const GREEK = /[\u0370-\u03ff\u1f00-\u1fff]/u;
const HEBREW = /[\u0590-\u05ff]/u;

class ScanCancelledError extends Error {
  constructor() {
    super('Scan cancelled by user.');
    this.name = 'ScanCancelledError';
  }
}

function languageForTerm(term: string): SmartAudioBookLexiconEntry['language'] {
  if (HEBREW.test(term)) return 'biblical_hebrew';
  if (GREEK.test(term)) return 'koine_greek';
  return 'other';
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
    // A partial scan cannot certify a Scholar audiobook as ready. Keep this
    // server-side as well as in the UI so callers cannot accidentally create
    // another 80% scan that later fails the audiobook preflight.
    const target = 100;
    const query = body.query || null;
    const generateOnlyForNewWords = body.generateOnlyForNewWords !== false;
    const forceUseBackupKey = body.forceUseBackupKey === true;

    const jobId = randomUUID();
    const jobKey = `foreign_word_scan:${jobId}`;

    const initialJobState = {
      id: jobId,
      userId,
      documentId,
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
      const ensureScanNotCancelled = async () => {
        const rows = await db.select({ valueJson: adminSettings.valueJson })
          .from(adminSettings)
          .where(eq(adminSettings.key, jobKey))
          .limit(1);
        const current = rows[0]?.valueJson;
        const parsed = typeof current === 'string' ? JSON.parse(current) : current;
        if (parsed && typeof parsed === 'object' && (parsed as { status?: unknown }).status === 'cancelled') {
          throw new ScanCancelledError();
        }
      };
      const saveJob = async (patch: Record<string, unknown>) => {
        if (patch.status !== 'cancelled') await ensureScanNotCancelled();
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
        const candidateCacheKey = foreignWordCandidateCacheKey({
          userId,
          documentId,
          mode,
          target,
          query,
        });
        const cachedRows = await db.select({ valueJson: adminSettings.valueJson })
          .from(adminSettings)
          .where(eq(adminSettings.key, candidateCacheKey))
          .limit(1);
        let words = parseForeignWordCandidateCache(cachedRows[0]?.valueJson) as any[] | null;
        if (words) {
          serverLogger.info(
            { event: 'pdf.scan.candidates.cache_hit', documentId, mode, target },
            'Reusing cached PDF foreign-word candidates',
          );
        } else {
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

          words = JSON.parse(stdout);
          if (!Array.isArray(words)) {
            throw new Error('PDF foreign-word scanner returned an invalid candidate list.');
          }
          const cachedCandidates = JSON.stringify({ version: 4, words });
          await db.insert(adminSettings).values({
            key: candidateCacheKey,
            valueJson: cachedCandidates,
            source: 'runtime',
          }).onConflictDoUpdate({
            target: adminSettings.key,
            set: {
              valueJson: cachedCandidates,
              source: 'runtime',
              updatedAt: Date.now(),
            },
          });
        }

        if (mode !== 'custom') {
          const originalCount = words.length;
          words = words.filter(isUsableForeignWordCandidate);
          const skippedPhraseCandidates = originalCount - words.length;
          if (skippedPhraseCandidates > 0) {
            serverLogger.info(
              { event: 'pdf.scan.candidates.filtered', documentId, skippedPhraseCandidates },
              'Excluded non-lexical multi-word or IPA-key foreign-word candidates',
            );
          }
        }

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
        const globalDefinitions = await readGlobalDefinitions();
        
        const overrides = activeProfile?.pronunciations || {};
        const compatibleOverrides = Object.fromEntries(
          Object.entries(overrides).filter(([word, pronunciation]) => (
            isKokoroSafePronunciation(word, pronunciation)
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
                  isKokoroSafePronunciation(word, pronunciation)
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
        for (const [term, entry] of Object.entries(lexiconEntries)) {
          if (shouldOmitDictionaryDefinition(entry.definition)) {
            lexiconEntries[term] = {
              ...entry,
              definition: null,
              definitionOmitted: true,
              needsReview: false,
            };
          }
          if (!entry.definition && globalDefinitions[term]) {
            lexiconEntries[term] = {
              ...lexiconEntries[term],
              definition: globalDefinitions[term],
              definitionOmitted: false,
            };
          }
        }
        for (const w of words) {
          const term = w.word;
          if (!term || typeof term !== 'string') continue;
          const userPron = compatibleOverrides[term] || null;
          const globalPron = preExistingCompatibleGlobalWords.has(term)
            ? globalDict[term]
              ?.map((choice) => choice?.phonetic)
              .find((pronunciation) => isKokoroSafePronunciation(term, pronunciation)) || null
            : null;
          const libraryPron = userPron || globalPron;
          if (libraryPron && !lexiconEntries[term]) {
            lexiconEntries[term] = {
              term,
              pronunciation: libraryPron,
              definition: globalDefinitions[term] || null,
              definitionOmitted: globalDefinitions[term] ? false : undefined,
              language: languageForTerm(term),
              context: Array.isArray(w.contexts) ? w.contexts[0] : undefined,
            };
          }
        }
        const needsScholarDefinition = activeProfile?.workerMode === 'scholar';

        const wordsMissingOptions = words
          .filter((w: any) => {
            const compatibleGlobalChoices = (globalDict[w.word] || []).filter((choice) => (
              isKokoroSafePronunciation(w.word, choice?.phonetic)
            ));
            const needsPronunciations = !compatibleOverrides[w.word]
              && (compatibleGlobalChoices.length === 0
                || (!generateOnlyForNewWords && compatibleGlobalChoices.length < 5));
            const language = languageForTerm(w.word);
            const lexiconEntry = lexiconEntries[w.word];
            const needsDefinition = needsScholarDefinition
              && language !== 'other'
              && (!lexiconEntry || (
                lexiconEntry.language !== 'other'
              && !lexiconEntry.definition
                && !globalDefinitions[w.word]
                && lexiconEntry.definitionOmitted !== true
              ));
            return needsPronunciations || needsDefinition;
          })
          .map((w: any) => w.word);

        const enrichWords = () => words.map((w: any) => {
          const userPronunciation = compatibleOverrides[w.word] || null;
          const globalPronunciation = preExistingCompatibleGlobalWords.has(w.word)
            ? globalDict[w.word]
              ?.map((choice) => choice?.phonetic)
              .find((pronunciation) => isKokoroSafePronunciation(w.word, pronunciation)) || null
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
            definitionOmitted: lexiconEntries[w.word]?.definitionOmitted === true,
            definitionNeedsReview: lexiconEntries[w.word]?.needsReview === true,
            ocrSuspect: w.ocrSuspect === true,
            ocrFragment: confirmedOcrFragments.has(w.word),
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
        const confirmedOcrFragments = new Set<string>();
        let acceptedChoices = 0;
        let updatedLexicon = false;
        let terminalGeminiError: string | null = null;

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
        await ensureScanNotCancelled();
        if (i > 0) {
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
        const chunk = wordsMissingOptions.slice(i, i + chunkSize);
        const libraryAtBatchStart = JSON.parse(JSON.stringify(globalDict)) as Record<string, any[]>;
        const batchUpdatedWords = new Set<string>();
        const terms = chunk.map((word: string) => {
          const scanned = words.find((item: any) => item.word === word);
          const storedPronunciation = compatibleOverrides[word]
            || (globalDict[word] || [])
              .map((choice) => choice?.phonetic)
              .find((choice) => isKokoroSafePronunciation(word, choice));
          return {
            term: word,
            contexts: Array.isArray(scanned?.contexts) ? scanned.contexts.slice(0, 2) : [],
            currentPronunciation: storedPronunciation || null,
            ocrSuspect: scanned?.ocrSuspect === true,
            ocrEvidence: Array.isArray(scanned?.ocrEvidence) ? scanned.ocrEvidence.slice(0, 2) : [],
          };
        });
        const prompt = `${buildKokoroPronunciationInstructions(activeProfile)}

Create pronunciation choices and short audiobook definitions for these terms.
For each term without currentPronunciation, return 5 distinct, plausible Kokoro IPA pronunciation variations and put the best first.
If currentPronunciation is supplied, preserve it exactly and return it as the only pronunciation; do not generate extra variations.
For Koine Greek or Biblical Hebrew, use the supplied contexts to return a contextual English definition of one to four words.
If the surrounding book context already states the definition, return that same concise gloss; OpenReader will recognize the author-supplied definition and will not speak it twice.
Set language to "koine_greek", "biblical_hebrew", or "other". For other languages, abbreviations, or invented names, set language to "other" and definition to null.
If a token is an OCR fragment, an unidentifiable fragment, or an inflected form with no reliable contextual English gloss, return definition as null and definitionOmitted as true. Never use placeholder text such as "Fragment or inflected form" as a definition.
When ocrSuspect is true, inspect ocrEvidence before deciding. Set ocrFragment to true only if that raw mixed-script/bracketed OCR token proves the requested term is a damaged fragment. For a confirmed OCR fragment return pronunciations as [], language as "other", definition as null, definitionOmitted as true, and needsReview as false. Do not attempt to reconstruct or invent a replacement term.
For all other terms set ocrFragment to false.
Otherwise return a useful contextual definition and set definitionOmitted to false.
Return a JSON array with exactly one result object per requested term. Copy each requested term exactly into that result object's "term" field.

Terms:
${JSON.stringify(terms)}`;
        
        const requestGeminiResults = async (
          requestPrompt: string,
          pass: 'pronunciation_definition_scan' | 'pronunciation_quality_repair',
        ) => {
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
                  contents: [{ role: 'user', parts: [{ text: requestPrompt }] }],
                  generationConfig: {
                    responseMimeType: 'application/json',
                    maxOutputTokens: 8192,
                    responseJsonSchema: GEMINI_FOREIGN_WORD_RESPONSE_JSON_SCHEMA,
                  },
                }),
              },
            ),
          });
          const data = await res.json().catch(() => null);
          if (!res.ok) {
            throw createGeminiHttpError(res.status, data, [
              apiKey,
              activeProfile?.backupGeminiApiKey || '',
            ]);
          }
          serverLogger.info({
            event: 'pdf.scan.gemini.usage',
            jobId,
            documentId,
            model,
            usedBackup,
            pass,
            batch: i / chunkSize + 1,
            tokens: normalizeGeminiTokenUsage(data?.usageMetadata),
          }, 'Recorded Gemini pronunciation and definition scan token usage.');
          const generatedText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
          if (!generatedText) {
            throw new Error('Gemini returned no pronunciation choices.');
          }
          const { results, repaired } = parseGeminiForeignWordResults(generatedText);
          if (repaired) {
            serverLogger.warn(
              { event: 'pdf.scan.gemini.json_repaired', jobId, pass, batch: i / chunkSize + 1 },
              'Recovered complete results from a truncated Gemini JSON array',
            );
          }
          return results;
        };

        try {
          let generated = await requestGeminiResults(prompt, 'pronunciation_definition_scan');
          const repairRequests = collectGeminiPronunciationRepairRequests(terms, generated);
          if (repairRequests.length > 0) {
            const repairPrompt = `${buildKokoroPronunciationInstructions(activeProfile)}

This is the only automatic correction pass for these terms. Your previous response violated OpenReader's Kokoro pronunciation policy or omitted required choices.
Return only the listed terms, using the same JSON response structure. Correct every listed violation and provide exactly choicesNeeded new, distinct choices for each term.
Do not return any rejected pronunciation or repeat an accepted pronunciation.
Never place /y/ directly beside /j/ and never repeat /j/; choose one appropriate glide.
For an initialism, return separated single English capital letters such as /K, T, L/, never grouped capitals such as /K, TL/ or /TH, N/.
Copy each term exactly. Preserve its language and contextual meaning. Do not add terms that are not listed.

Corrections:
${JSON.stringify(repairRequests)}`;

            await saveJob({
              statusMessage: `Correcting ${repairRequests.length} pronunciation ${repairRequests.length === 1 ? 'result' : 'results'} (one automatic pass)…`,
            });
            try {
              const repairs = await requestGeminiResults(repairPrompt, 'pronunciation_quality_repair');
              generated = mergeGeminiPronunciationRepairResults(generated, repairs);
            } catch (repairError) {
              serverLogger.warn({
                event: 'pdf.scan.gemini.quality_repair.failed',
                error: repairError instanceof Error ? repairError.message : 'Unknown Gemini correction error',
                jobId,
                batch: i / chunkSize + 1,
              }, 'The single Gemini pronunciation quality correction pass failed');
              if (repairError instanceof GeminiHttpError && repairError.status === 400) {
                throw repairError;
              }
            } finally {
              await saveJob({ statusMessage: null });
            }
          }

          const unresolvedQualityTerms = new Set(
            collectGeminiPronunciationRepairRequests(terms, generated)
              .map((request) => request.term),
          );
          if (unresolvedQualityTerms.size > 0) {
            serverLogger.warn({
              event: 'pdf.scan.gemini.quality_unresolved',
              terms: [...unresolvedQualityTerms],
              jobId,
              batch: i / chunkSize + 1,
            }, 'Pronunciations still require review after the single automatic correction pass');
          }

          const acceptedWords = new Set<string>();
          const requestedTerms = new Map(chunk.map((term: string) => [term, term]));
          for (const result of generated) {
            const w = requestedTerms.get(result.term);
            if (w) {
              const scanned = words.find((item: any) => item.word === w);
              if (scanned?.ocrSuspect === true && result.ocrFragment === true) {
                // Gemini, not a brittle local heuristic, made the final call.
                // Do not let a confirmed OCR shard reuse or create a global entry.
                confirmedOcrFragments.add(w);
                if (Object.prototype.hasOwnProperty.call(lexiconEntries, w)) {
                  delete lexiconEntries[w];
                  updatedLexicon = true;
                }
                acceptedWords.add(w);
                continue;
              }
              const prons = Array.isArray(result.pronunciations) ? result.pronunciations : [];
              const current = (globalDict[w] || []).filter((choice) => (
                isKokoroSafePronunciation(w, choice?.phonetic)
              ));
              const existingPhonetics = new Set(current.map(c => c.phonetic));

              for (const p of prons) {
                if (
                  !compatibleOverrides[w]
                  && isKokoroSafePronunciation(w, p)
                  && !existingPhonetics.has(p)
                  && current.length < 5
                ) {
                  if (!geminiRecommendations[w]) geminiRecommendations[w] = p;
                  current.push({ phonetic: p, usageCount: 0, isUserCustom: false, timestamp: Date.now() });
                  existingPhonetics.add(p);
                  acceptedChoices += 1;
                  acceptedWords.add(w);
                  batchUpdatedWords.add(w);
                  updatedGlobalWords.add(w);
                }
              }
              globalDict[w] = current;

              const pronunciation = compatibleOverrides[w]
                || current[0]?.phonetic
                || prons.find((candidate) => isKokoroSafePronunciation(w, candidate));
              if (pronunciation) {
                if (!geminiRecommendations[w] && !compatibleOverrides[w] && !preExistingCompatibleGlobalWords.has(w)) {
                  geminiRecommendations[w] = pronunciation;
                }
                const definitionOmitted = result.definitionOmitted === true
                  || shouldOmitDictionaryDefinition(result.definition);
                const definition = definitionOmitted
                  ? null
                  : normalizeDictionaryDefinition(result.definition);
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
                  definitionOmitted,
                  language,
                  context: Array.isArray(scanned?.contexts) ? scanned.contexts[0] : undefined,
                  confidence: typeof result.confidence === 'number'
                    ? Math.max(0, Math.min(1, result.confidence))
                    : undefined,
                  needsReview: (result.needsReview === true && !definitionOmitted)
                    || unresolvedQualityTerms.has(w)
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

          // Persist each successful batch immediately. The job checkpoint and
          // the generated library now advance together, so a process restart
          // cannot discard all choices accumulated before the final save.
          if (batchUpdatedWords.size > 0) {
            const persistedWords = await mergeGeneratedGlobalPronunciations({
              generatedLibrary: globalDict,
              libraryAtScanStart: libraryAtBatchStart,
              updatedWords: batchUpdatedWords,
            });
            serverLogger.info({
              event: 'pdf.scan.global_pronunciations.batch_persisted',
              jobId,
              databaseProvider: process.env.POSTGRES_URL ? 'postgresql' : 'sqlite',
              batch: i / chunkSize + 1,
              requestedWords: batchUpdatedWords.size,
              persistedWords: persistedWords.length,
            }, 'Persisted generated global pronunciations for completed batch');
          }
          const batchDefinitions = Object.fromEntries(
            chunk
              .map((term: string) => [term, lexiconEntries[term]?.definition] as const)
              .filter(([, definition]) => Boolean(definition)),
          );
          if (Object.keys(batchDefinitions).length > 0) {
            const persistedDefinitions = await mergeGlobalDefinitions(batchDefinitions);
            serverLogger.info({
              event: 'pdf.scan.global_definitions.batch_persisted',
              jobId,
              batch: i / chunkSize + 1,
              persistedDefinitions: persistedDefinitions.length,
            }, 'Persisted generated global definitions for completed batch');
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Unknown Gemini error';
          serverLogger.error({
            event: 'pdf.scan.gemini.batch.failed',
            error: message,
            httpStatus: err instanceof GeminiHttpError ? err.status : undefined,
            jobId,
            batch: i / chunkSize + 1,
          }, 'Gemini pronunciation batch failed');
          const errors = Array.isArray(jobState.errors) ? [...jobState.errors, `Gemini batch ${i / chunkSize + 1}: ${message}`] : [`Gemini batch ${i / chunkSize + 1}: ${message}`];
          await saveJob({ errors, completed: Math.min(i + chunk.length, wordsMissingOptions.length) });
          if (err instanceof GeminiHttpError && err.status === 400) {
            terminalGeminiError = message;
            break;
          }
        }
        await saveJob({ completed: Math.min(i + chunk.length, wordsMissingOptions.length) });
      }
        }

    const generated = Object.keys(geminiRecommendations).length;
    const generatedDefinitions = Object.fromEntries(
      Object.entries(lexiconEntries)
        .filter(([, entry]) => Boolean(entry.definition) && entry.definitionOmitted !== true)
        .map(([term, entry]) => [term, entry.definition]),
    );
    await saveJob({
      stage: 'persisting',
      generated,
      generatedChoices: acceptedChoices,
      words: enrichWords(),
    });

    if (updatedGlobalWords.size > 0) {
      const persistedWords = await mergeGeneratedGlobalPronunciations({
        generatedLibrary: globalDict,
        libraryAtScanStart: globalDictAtScanStart,
        updatedWords: updatedGlobalWords,
      });
      serverLogger.info({
        event: 'pdf.scan.global_pronunciations.persisted',
        jobId,
        databaseProvider: process.env.POSTGRES_URL ? 'postgresql' : 'sqlite',
        requestedWords: updatedGlobalWords.size,
        persistedWords: persistedWords.length,
      }, 'Persisted generated global pronunciations');
    }
    if (Object.keys(generatedDefinitions).length > 0) {
      const persistedDefinitions = await mergeGlobalDefinitions(generatedDefinitions);
      serverLogger.info({
        event: 'pdf.scan.global_definitions.persisted',
        jobId,
        persistedDefinitions: persistedDefinitions.length,
      }, 'Persisted generated global definitions');
    }

    if (activeProfile) {
      const errors = Array.isArray(jobState.errors) ? jobState.errors : [];
      const requiredDefinitionWords = needsScholarDefinition
        ? words
          .map((word: any) => word.word as string)
          .filter((word: string) => !confirmedOcrFragments.has(word))
          .filter((word: string) => languageForTerm(word) !== 'other')
        : [];
      const definitionScanComplete = requiredDefinitionWords.every(
        (word: string) => Boolean(
          lexiconEntries[word]?.pronunciation
          && isKokoroSafePronunciation(word, lexiconEntries[word].pronunciation),
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

        const errors = Array.isArray(jobState.errors) ? jobState.errors : [];
        await saveJob({
          status: terminalGeminiError ? 'failed' : 'completed',
          completed: terminalGeminiError
            ? jobState.completed
            : wordsMissingOptions.length,
          generated,
          generatedChoices: acceptedChoices,
          error: terminalGeminiError
            || (errors.length > 0 ? `${errors.length} Gemini batch${errors.length === 1 ? '' : 'es'} failed. ${errors[0]}` : null),
          words: enrichWords(),
        });
      } catch (error) {
        if (error instanceof ScanCancelledError) {
          serverLogger.info({ event: 'pdf.scan.cancelled', jobId, documentId }, 'Foreign-word scan cancelled by user');
          return;
        }
        serverLogger.error({
          event: 'pdf.scan.pronunciations.failed',
          error: error instanceof Error ? error.message : String(error),
          jobId,
        }, 'Background foreign-word pronunciation generation failed');
        await saveJob({ status: 'failed', error: error instanceof Error ? error.message : 'Background pronunciation generation failed' }).catch(() => {});
      }
    });

    return NextResponse.json({ words: [], scanJobId: jobId, scanStatus: 'queued', scanTotal: 0 }, { status: 202 });
  } catch (error: any) {
    serverLogger.error({
      event: 'pdf.scan.failed',
      error: error instanceof Error ? error.message : String(error),
    }, 'Scan foreign words error');
    console.error('Scan foreign words error:', error);
    return NextResponse.json({ error: error?.message || 'Failed to scan document' }, { status: 500 });
  }
}
