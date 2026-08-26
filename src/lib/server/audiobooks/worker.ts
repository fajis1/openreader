import { processBatchRefineJob } from './refine';

import {
  findSmartAudioProfileById,
  mergeGeneratedPronunciationsIntoLatestProfile,
  readSmartAudioProfilesDocument,
} from '@/lib/server/smart-audio-profiles';
import { eq, and, asc, lt, inArray, sql, or } from 'drizzle-orm';
import { db } from '@/db';
import { audiobookJobs, documents, audiobooks, audiobookChapters, adminSettings, documentSettings } from '@/db/schema';
import { readCurrentParsedPdfArtifact } from '@/lib/server/pdf-parse/artifact';
import { getDocumentBlob } from '@/lib/server/documents/blobstore';
import { checkSystemResources } from '@/lib/server/audiobooks/system-monitor';
import { randomUUID } from 'node:crypto';
import { resolveTtsCredentials } from '@/lib/server/admin/resolve-credentials';
import { getResolvedRuntimeConfig } from '@/lib/server/runtime-config';
import { putAudiobookObject } from '@/lib/server/audiobooks/blobstore';
import { encodeChapterFileName } from '@/lib/server/audiobooks/chapters';
import { createOrReuseCurrentPdfParseOperation } from '@/lib/server/pdf-parse/operation';
import { extractPdfToc, computeTocBoundaries } from '@/lib/server/pdf-parse/toc';
import type { ParsedPdfDocument } from '@/types/parsed-pdf';
import { serverLogger, errorToLog } from '@/lib/server/logger';
import { INTERNAL_WORKER_SECRET } from '@/lib/server/internal-secret';
import {
  buildKokoroPronunciationInstructions,
  filterKokoroCompatiblePronunciationRecord,
} from '@/lib/shared/kokoro-pronunciation-policy';
import {
  AUDIOBOOK_ADMIN_PAUSE_REQUESTED_STATUS,
  GEMINI_RATE_LIMIT_PAUSE_MESSAGE,
} from '@/lib/shared/audiobook-job-status';
import {
  resolveCleanupAiModel,
  resolveCleanupAiModels,
  resolveSmartAudioValidationRepairModel,
} from '@/lib/shared/smart-audio-models';
import {
  AUDIOBOOK_END_MATTER_START_FRACTION,
  isAudiobookEndMatterHeading,
  truncateAudiobookEndMatter,
} from '@/lib/shared/audiobook-end-matter';
import {
  extractAudiobookTextFromEpub,
  stripAudiobookHtml,
} from '@/lib/server/audiobooks/document-source';
import {
  batchAudiobookText,
  cleanupBatchTargetForVersion,
  CURRENT_AUDIOBOOK_BATCH_VERSION,
} from '@/lib/shared/audiobook-batching';
import {
  collectSmartAudioTermCandidates,
  enrichTextFromBookLexicon,
  readBookLexicon,
  pronunciationsFromBookLexicon,
  resolveSmartAudioBookLexicon,
  selectPronunciationsForText,
  writeBookLexicon,
} from '@/lib/server/smart-audio/book-lexicon';
import { normalizeGeminiTokenUsage } from '@/lib/server/smart-audio/gemini-usage';
import { generateSegmentedAudiobookTtsBuffer } from '@/lib/server/audiobooks/segmented-tts';
import { resolveSmartAudioNatsTimeoutMs } from '@/lib/server/audiobooks/smart-audio-timeout';
import { mergeGlobalDefinitions, readGlobalDefinitions } from '@/lib/server/smart-audio/global-definition-library';
import { preparePdfAudiobookBlocks } from '@/lib/shared/pdf-audiobook-blocks';
import { mergeDocumentSettings } from '@/lib/shared/document-settings';
import { DEFAULT_DOCUMENT_SETTINGS } from '@/types/document-settings';
import {
  buildSmartAudioCleanupPrompt,
  extractNarratableSmartAudioSourceText,
  FINAL_SMART_AUDIO_PRONUNCIATION_CHECK,
  hasConfirmedSmartAudioEndMatterHint,
  isScholarLikeSmartAudioMode,
  resolveSmartAudioWorkerResult,
  stripSmartAudioInputMarkers,
  validateSmartAudioOutput,
} from '@/lib/shared/smart-audio-cleanup';
import {
  buildMultiVoiceCast,
  getCharacterMapReadiness,
  MULTI_VOICE_WORKER_MODE,
  resolveMultiVoiceWorkerResult,
  type MultiVoiceCastMember,
  WAITING_FOR_VOICES_STATUS,
} from '@/lib/shared/multi-voice';
import {
  buildSmartAudioValidationRepairPayload,
  resolveSmartAudioWithValidationRecovery,
} from '@/lib/server/audiobooks/smart-audio-validation-recovery';

const SMART_AUDIO_NATS_SUBJECT = 'audiobooks.gemini.clean';
// Scholar and bibliography-catcher both use the scholar Python worker,
// which produces changelogs, chapter titles, and inline definitions.
const SCHOLAR_NATS_SUBJECT = 'audiobooks.scholar.clean';

function isScholarLikeMode(mode: string | undefined): boolean {
  return isScholarLikeSmartAudioMode(mode);
}

async function readGlobalPronunciationDefaults(): Promise<Record<string, string>> {
  const rows = await db
    .select({ valueJson: adminSettings.valueJson })
    .from(adminSettings)
    .where(eq(adminSettings.key, 'global_pronunciations'))
    .limit(1);
  if (!rows[0]?.valueJson) return {};
  try {
    const parsed = typeof rows[0].valueJson === 'string'
      ? JSON.parse(rows[0].valueJson)
      : rows[0].valueJson;
    const defaults: Record<string, string> = {};
    for (const [term, raw] of Object.entries(parsed as Record<string, unknown>)) {
      const first = Array.isArray(raw) ? raw[0] : raw;
      const pronunciation = typeof first === 'string'
        ? first
        : first && typeof first === 'object' && typeof (first as Record<string, unknown>).phonetic === 'string'
          ? String((first as Record<string, unknown>).phonetic)
          : '';
      if (pronunciation) defaults[term] = pronunciation;
    }
    return defaults;
  } catch {
    return {};
  }
}

const globalWorkerState = globalThis as unknown as { __worker_booted?: boolean };

class AudiobookJobStoppedError extends Error {
  constructor() {
    super('Audiobook job is no longer owned by this worker.');
    this.name = 'AudiobookJobStoppedError';
  }
}

async function acknowledgeAudiobookPause(jobId: string): Promise<boolean> {
  const rows = await db.update(audiobookJobs)
    .set({ status: 'paused', updatedAt: Date.now() })
    .where(and(
      eq(audiobookJobs.id, jobId),
      eq(audiobookJobs.status, AUDIOBOOK_ADMIN_PAUSE_REQUESTED_STATUS),
    ))
    .returning({ id: audiobookJobs.id });
  if (rows.length > 0) {
    serverLogger.info({ event: 'audiobook.queue.admin_paused', jobId }, 'Worker acknowledged an administrator pause request.');
  }
  return rows.length > 0;
}

async function updateAudiobookJobIfStatus(
  jobId: string,
  expectedStatus: string,
  values: Partial<typeof audiobookJobs.$inferInsert>,
): Promise<boolean> {
  const rows = await db.update(audiobookJobs)
    .set(values)
    .where(and(eq(audiobookJobs.id, jobId), eq(audiobookJobs.status, expectedStatus)))
    .returning({ id: audiobookJobs.id });
  if (rows.length > 0) return true;
  await acknowledgeAudiobookPause(jobId);
  return false;
}

async function updateClaimedAudiobookJob(
  jobId: string,
  expectedStatus: string,
  values: Partial<typeof audiobookJobs.$inferInsert>,
): Promise<void> {
  if (!await updateAudiobookJobIfStatus(jobId, expectedStatus, values)) {
    throw new AudiobookJobStoppedError();
  }
}

async function workerStillOwnsAudiobookJob(jobId: string): Promise<boolean> {
  const rows = await db.select({ status: audiobookJobs.status })
    .from(audiobookJobs)
    .where(eq(audiobookJobs.id, jobId))
    .limit(1);
  if (rows[0]?.status === 'running') return true;
  await acknowledgeAudiobookPause(jobId);
  return false;
}

export async function processAudiobookQueue() {
  if (!globalWorkerState.__worker_booted) {
    globalWorkerState.__worker_booted = true;
    serverLogger.info({ event: 'audiobook.queue.boot' }, 'Worker booted. Resetting any orphaned running jobs to queued.');
    await db.update(audiobookJobs)
      .set({ status: 'paused', updatedAt: Date.now() })
      .where(eq(audiobookJobs.status, AUDIOBOOK_ADMIN_PAUSE_REQUESTED_STATUS));
    await db.update(audiobookJobs)
      .set({ status: 'queued', progress: 0 })
      .where(eq(audiobookJobs.status, 'running'));
  } else {
    // Reset any jobs that have been "running" for over 15 minutes without an update (stale crash recovery)
    const staleThreshold = Date.now() - 15 * 60 * 1000;
    await db.update(audiobookJobs)
      .set({ status: 'queued', progress: 0 })
      .where(and(eq(audiobookJobs.status, 'running'), lt(audiobookJobs.updatedAt, staleThreshold)));
  }

  const resources = await checkSystemResources();
  if (!resources.ok) {
    serverLogger.warn({ event: 'audiobook.queue.degraded', reason: resources.reason }, `System resources degraded: ${resources.reason}`);
    return;
  }

  const MAX_CONCURRENT_JOBS = 3;

  const RATE_LIMIT_BACKOFF_MS = 24 * 60 * 60 * 1000; // 24 hours
  const backoffThreshold = Date.now() - RATE_LIMIT_BACKOFF_MS;

  const rows = await db.select()
    .from(audiobookJobs)
    .where(
      and(
        inArray(audiobookJobs.status, ['queued', 'waiting_for_pdf']),
        or(
          sql`${audiobookJobs.error} IS NULL`,
          sql`${audiobookJobs.error} != ${GEMINI_RATE_LIMIT_PAUSE_MESSAGE}`,
          lt(audiobookJobs.updatedAt, backoffThreshold)
        )
      )
    )
    .orderBy(asc(audiobookJobs.createdAt))
    .limit(MAX_CONCURRENT_JOBS);
  
  if (rows.length === 0) return;
  
  const jobIds = rows.map((r: typeof rows[0]) => r.id);
  const updateResult = await db.update(audiobookJobs)
    .set({ status: 'running', startedAt: Date.now(), error: null })
    .where(and(inArray(audiobookJobs.id, jobIds), inArray(audiobookJobs.status, ['queued', 'waiting_for_pdf'])))
    .returning();
    
  if (updateResult.length === 0) return;
  
  await Promise.allSettled(updateResult.map((job: typeof updateResult[0]) => processSingleAudiobookJob(job)));
}

async function processSingleAudiobookJob(job: typeof audiobookJobs.$inferSelect) {
  const updateProgress = async (progress: number) => {
    await updateClaimedAudiobookJob(job.id, 'running', { progress, updatedAt: Date.now() });
  };

  const markError = async (err: string) => {
    await updateAudiobookJobIfStatus(job.id, 'running', {
      status: 'error',
      error: err,
      completedAt: Date.now(),
    });
  };

  try {
    serverLogger.info({ event: 'audiobook.queue.start', jobId: job.id, documentId: job.documentId }, `Starting background audiobook generation job ${job.id}`);
    if (!await workerStillOwnsAudiobookJob(job.id)) return;
    const docRows = await db.select().from(documents).where(eq(documents.id, job.documentId));
    if (docRows.length === 0) throw new Error('Document not found');
    const doc = docRows[0];

    const bookId = doc.id;
    const userId = job.userId;
    const jobSettings = typeof job.settingsJson === 'string' ? JSON.parse(job.settingsJson) : (job.settingsJson || {});

    if (jobSettings.jobType === 'batch-refine') {
      await processBatchRefineJob(job, updateProgress, markError);
      await updateClaimedAudiobookJob(job.id, 'running', { status: 'completed', progress: 100, completedAt: Date.now() });
      return;
    }

    if (jobSettings.jobType === 'combine') {
      const { executeAudiobookCombine } = await import('./combine');
      try {
        serverLogger.info({ event: 'audiobook.combine.debug' }, 'Calling executeAudiobookCombine...');
        await executeAudiobookCombine(bookId, userId, jobSettings.format, jobSettings.testNamespace, updateProgress);
        serverLogger.info({ event: 'audiobook.combine.debug' }, 'Updating combine job status to completed...');
        await updateClaimedAudiobookJob(job.id, 'running', { status: 'completed', progress: 100, completedAt: Date.now() });
        serverLogger.info({ event: 'audiobook.queue.complete', jobId: job.id, documentId: job.documentId }, `Successfully completed audiobook combine job ${job.id}`);
      } catch (combineError) {
        serverLogger.error({ event: 'audiobook.combine.failed', jobId: job.id, error: errorToLog(combineError) }, 'Audiobook background combine failed');
        await markError((combineError as Error)?.message || 'Combine failed');
      }
      return;
    }

    const existingBook = await db.select().from(audiobooks).where(and(eq(audiobooks.id, bookId), eq(audiobooks.userId, userId)));
    // Missing/legacy versions must retain the exact pre-12K chapter map so a
    // resumed job never reuses an existing numeric index for different text.
    const usesCurrentBatching = jobSettings.cleanupBatchVersion === CURRENT_AUDIOBOOK_BATCH_VERSION;
    const cleanupTargetCharacters = cleanupBatchTargetForVersion(jobSettings.cleanupBatchVersion);
    const hasSmartAudio = !!jobSettings?.useSmartAudio;
    const testNamespace = jobSettings?.testNamespace || null;

    if (existingBook.length === 0) {
      await db.insert(audiobooks).values({
        id: bookId,
        userId: userId,
        title: doc.name,
        hasSmartAudio,
      });
    } else if (hasSmartAudio && !existingBook[0].hasSmartAudio) {
      // Upgrade existing audiobook to show it has smart audio changelog
      await db.update(audiobooks).set({ hasSmartAudio: true }).where(eq(audiobooks.id, bookId));
    }

    // Foreground regeneration reads this metadata to reproduce the exact
    // chapter boundaries used by background queue generation.
    await putAudiobookObject(
      bookId,
      userId,
      'audiobook.meta.json',
      Buffer.from(JSON.stringify(jobSettings, null, 2), 'utf8'),
      'application/json; charset=utf-8',
      testNamespace,
    );

    let chapters: { index: number; title: string; text: string; cleanupText?: string }[] = [];
    let tocSectionsSkipped = 0;

    const documentSettingsRows = await db
      .select({ dataJson: documentSettings.dataJson })
      .from(documentSettings)
      .where(and(eq(documentSettings.documentId, doc.id), eq(documentSettings.userId, userId)))
      .limit(1);
    let rawDocumentSettings: unknown = documentSettingsRows[0]?.dataJson || {};
    if (typeof rawDocumentSettings === 'string') {
      try {
        rawDocumentSettings = JSON.parse(rawDocumentSettings);
      } catch {
        rawDocumentSettings = {};
      }
    }
    const resolvedDocumentSettings = mergeDocumentSettings(
      DEFAULT_DOCUMENT_SETTINGS,
      rawDocumentSettings,
    );

    const useSmartAudio = Boolean(jobSettings.useSmartAudio);
    const profilesDocument = useSmartAudio
      ? await readSmartAudioProfilesDocument(userId)
      : null;
    let selectedProfile = profilesDocument
      ? findSmartAudioProfileById(profilesDocument, String(jobSettings.smartAudioProfileId || ''))
      : null;
    if (useSmartAudio && !selectedProfile) {
      throw new Error('The selected Smart Audio profile could not be loaded.');
    }
    // Scholar and bibliography-catcher both get layout engine structural tags so
    // Gemini can understand PDF structure. Previously only bib-catcher had this.
    const useLayoutTags = isScholarLikeMode(selectedProfile?.workerMode);


    if (doc.type === 'pdf') {
      let artifact = await readCurrentParsedPdfArtifact({ documentId: doc.id, namespace: testNamespace });
      if (!artifact) {
        const opState = await createOrReuseCurrentPdfParseOperation({ documentId: doc.id, namespace: testNamespace });
        if (opState.status === 'failed') {
          throw new Error(opState.error?.message || 'PDF layout operation failed');
        }
        await updateClaimedAudiobookJob(job.id, 'running', { status: 'waiting_for_pdf' });
        
        // Wait up to 15 seconds for the PDF artifact (e.g. for compute-core to finish parsing it in the background)
        let found = false;
        for (let i = 0; i < 15; i++) {
          await new Promise(r => setTimeout(r, 1000));
          artifact = await readCurrentParsedPdfArtifact({ documentId: doc.id, namespace: testNamespace });
          if (artifact) {
            found = true;
            await updateClaimedAudiobookJob(job.id, 'waiting_for_pdf', { status: 'running' });
            break;
          }
        }
        
        if (!found) {
          return;
        }
      }
      if (!artifact) {
        return;
      }
      const parsedPdf = JSON.parse(artifact.bytes.toString('utf-8')) as ParsedPdfDocument;
      
      const buffer = await getDocumentBlob(doc.id, testNamespace);
      const toc = await extractPdfToc(buffer);
      let boundaries = computeTocBoundaries(toc, doc.pages || 9999);
      
      // FALLBACK MULTIVALENT SYSTEM: If digital TOC is missing, scan the vision-engine text!
      if (toc.length === 0 && parsedPdf && parsedPdf.pages) {
        console.log('\n[FALLBACK SCANNER] Digital TOC missing. Scanning vision engine text for boundaries...');
        
        // --- 1. Find Start Matter (scan first 30% forwards) ---
        const startLimit = Math.floor(parsedPdf.pages.length * 0.3);
        const frontMatterRegex = /^(introduction|chapter 1\b|part 1\b|foreword|preface|prologue)/i;
        for (let i = 0; i <= startLimit; i++) {
          const page = parsedPdf.pages[i];
          const hasStartMatterTitle = page.blocks.some(b => 
            (b.kind === 'paragraph_title' || b.kind === 'doc_title') && 
            b.text.trim().length < 50 &&
            frontMatterRegex.test(b.text.trim())
          );
          if (hasStartMatterTitle) {
            boundaries.startPage = page.pageNumber;
            console.log(`[FALLBACK SCANNER] Found Start Matter (Introduction/Chapter 1)! Setting start page to ${boundaries.startPage}`);
            break;
          }
        }

        // --- 2. Find End Matter (scan last 30% backwards) ---
        let fallbackEndPage = boundaries.endPage;
        const endMatterRegex = /^(bibliography|index|indexes|works cited|notes|appendix)/i;
        const endLimit = Math.floor(
          parsedPdf.pages.length * AUDIOBOOK_END_MATTER_START_FRACTION,
        );
        for (let i = parsedPdf.pages.length - 1; i >= endLimit; i--) {
          const page = parsedPdf.pages[i];
          const hasEndMatterTitle = page.blocks.some(b => 
            (b.kind === 'paragraph_title' || b.kind === 'doc_title') && 
            b.text.trim().length < 50 &&
            endMatterRegex.test(b.text.trim())
          );
          if (hasEndMatterTitle) {
            fallbackEndPage = page.pageNumber - 1;
          }
        }
        if (fallbackEndPage < boundaries.endPage) {
          boundaries.endPage = fallbackEndPage;
          console.log(`[FALLBACK SCANNER] Found End Matter! Setting end page to ${boundaries.endPage}`);
        }
      }

      serverLogger.info({ event: 'audiobook.toc.boundaries', startPage: boundaries.startPage, endPage: boundaries.endPage }, 'Computed TOC boundaries for PDF');
      console.log(`\n==========================================\n  TOC BOUNDARY CALCULATED\n  Start Page (Gemini hint before this): ${boundaries.startPage}\n  End Page (Gemini hint after this): ${boundaries.endPage}\n==========================================\n`);

      const preparedPdfBlocks = preparePdfAudiobookBlocks({
        parsed: parsedPdf,
        settings: resolvedDocumentSettings,
        cleanupBatchVersion: jobSettings.cleanupBatchVersion,
      });
      const allBlocks = preparedPdfBlocks.blocks;
      if (preparedPdfBlocks.skippedBlockCount > 0) {
        serverLogger.info({
          event: 'audiobook.queue.pdf_blocks.skipped',
          bookId,
          count: preparedPdfBlocks.skippedBlockCount,
          kinds: resolvedDocumentSettings.pdf?.skipBlockKinds || [],
        }, 'Removed configured PDF block kinds before chapter batching.');
      }
      if (preparedPdfBlocks.tocSkipped) {
        tocSectionsSkipped += 1;
        serverLogger.info({
          event: 'audiobook.queue.front_matter.skipped',
          bookId,
          section: 'table_of_contents',
        }, 'Removed the PDF table of contents before Smart Audio and TTS processing.');
      }
      if (preparedPdfBlocks.endMatterSkipped) {
        serverLogger.info({
          event: 'audiobook.queue.end_matter.omitted',
          bookId,
          reason: 'confirmed_pdf_end_matter',
          heading: preparedPdfBlocks.endMatterStartHeading,
          startPage: preparedPdfBlocks.endMatterStartPage,
          count: preparedPdfBlocks.endMatterSkippedBlockCount,
        }, 'Removed PP-DocLayout-confirmed PDF end matter before chapter batching.');
      }
      const chapterBoundaryKinds = new Set(['paragraph_title', 'doc_title']);
      
      let currentTitle = 'Introduction';
      let currentText: string[] = [];
      let currentLength = 0;
      let lastBlockWasTitle = false;
      
      let isInEndMatter = false;
      
      const flush = () => {
        let text = currentText.join('\n\n').trim();
        if (text) {
          if (isInEndMatter) {
             text = `[SYSTEM HINT: The layout engine detected that this section is located in the end-matter (e.g. bibliography, index, or notes) of the book. If this text is not part of the core narrative prose, please silently omit it.]\n\n` + text;
          }
          chapters.push({ index: chapters.length, title: currentTitle, text });
        }
        currentText = [];
        currentLength = 0;
        lastBlockWasTitle = false;
      };

      for (let blockIndex = 0; blockIndex < allBlocks.length; blockIndex += 1) {
        const block = allBlocks[blockIndex];
        const blockText = block.text.trim();
        if (!blockText) continue;

        if (block.pageNumber < boundaries.startPage) {
           continue;
        }
        
        if (chapterBoundaryKinds.has(block.kind)) {
          const blockProgress = blockIndex / Math.max(allBlocks.length, 1);
          const startsConfirmedEndMatter = blockProgress >= AUDIOBOOK_END_MATTER_START_FRACTION
            && (
              (usesCurrentBatching && isAudiobookEndMatterHeading(blockText))
              || block.pageNumber > boundaries.endPage
            );
          if (startsConfirmedEndMatter && !isInEndMatter) {
            // Finish the preceding narrative chunk before enabling the end-
            // matter hint. Otherwise a bibliography heading could cause the
            // prior chapter's prose to be included in the omission request.
            if (currentText.length > 0) flush();
            isInEndMatter = true;
          }
          
          if (currentLength >= cleanupTargetCharacters) {
            flush();
            currentTitle = blockText || `Chapter ${chapters.length + 1}`;
          } else if (currentText.length === 0) {
            currentTitle = blockText || `Chapter ${chapters.length + 1}`;
          }
          currentText.push(useLayoutTags ? `\n\n[LAYOUT_ENGINE_TAG: ${block.kind.toUpperCase()}]\n${blockText}` : blockText);
          currentLength += blockText.length + 2;
          lastBlockWasTitle = true;
        } else {
          const lastIndex = currentText.length - 1;
          const isContinuation = !lastBlockWasTitle && lastIndex >= 0 && !/[.!?…'"”’\]}):;]\s*$/.test(currentText[lastIndex]);

          // Only flush if we are safely AT a paragraph boundary!
          if (!isContinuation && currentLength >= cleanupTargetCharacters) {
            flush();
            currentTitle = currentTitle.endsWith('(Continued)') ? currentTitle : `${currentTitle} (Continued)`;
          }

          if (isContinuation && lastIndex >= 0) {
            currentText[lastIndex] += ' ' + blockText;
            currentLength += blockText.length + 1;
          } else {
            currentText.push(useLayoutTags ? `\n\n[LAYOUT_ENGINE_TAG: ${block.kind.toUpperCase()}]\n${blockText}` : blockText);
            currentLength += blockText.length + 2;
          }
          lastBlockWasTitle = false;
        }
      }
      flush();

    } else if (doc.type === 'epub') {
      const buffer = await getDocumentBlob(doc.id, testNamespace);
      const epubChapters = await extractAudiobookTextFromEpub(buffer);
      chapters = epubChapters.map((c, i) => ({ index: i, title: c.title, text: c.text }));
    } else if (doc.type === 'txt' || doc.type === 'html') {
      const buffer = await getDocumentBlob(doc.id, testNamespace);
      let text = buffer.toString('utf-8');
      if (doc.type === 'html') text = stripAudiobookHtml(text);
      chapters = [{ index: 0, title: 'Document', text }];
    } else {
      throw new Error(`Unsupported document type: ${doc.type}`);
    }

    const runtimeConfig = await getResolvedRuntimeConfig();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const settings = jobSettings as Record<string, any>;
    if (usesCurrentBatching) {
      chapters = batchAudiobookText(
        truncateAudiobookEndMatter(chapters),
        cleanupTargetCharacters,
      );
    }
    if (useLayoutTags) {
      chapters = chapters
        .map((chapter) => ({
          ...chapter,
          cleanupText: chapter.text,
          text: stripSmartAudioInputMarkers(chapter.text),
        }))
        .filter((chapter) => Boolean(chapter.text));
    }
    if (chapters.length === 0) throw new Error('No audiobook content found before end matter');
    const format = (settings.format as 'mp3' | 'm4b') || 'm4b';

    const creds = await resolveTtsCredentials({
      providerHeader: settings.providerRef || null,
      apiKeyHeader: null,
      baseUrlHeader: null,
      fallbackProvider: runtimeConfig.defaultTtsProvider,
      restrictUserApiKeys: true,
    });

    if ('error' in creds) {
      throw new Error(`Failed to resolve TTS credentials: ${creds.error}. Background generation requires admin TTS providers.`);
    }

    let processedLength = 0;
    let totalBytes = 0;
    const totalLength = chapters.reduce((sum, c) => sum + c.text.length, 0);
    const pronunciationsAtAutoScanStart = {
      ...(selectedProfile?.pronunciations || {}),
    };
    // The global library is always the baseline. Profile pronunciations are
    // applied afterward and therefore act as per-word local overrides.
    const globalPronunciations = await readGlobalPronunciationDefaults();
    const globalDefinitions = isScholarLikeMode(selectedProfile?.workerMode)
      ? await readGlobalDefinitions()
      : {};
    let resolvedPronunciations = filterKokoroCompatiblePronunciationRecord({
      ...globalPronunciations,
      ...(selectedProfile?.pronunciations || {}),
    });
    let bookLexicon = isScholarLikeMode(selectedProfile?.workerMode)
      ? await readBookLexicon(userId, doc.id)
      : null;
    const definitionsBeforeAutoScan = new Map(
      Object.entries(bookLexicon && bookLexicon.profileId === selectedProfile?.id ? bookLexicon.entries : {})
        .map(([term, entry]) => [term, entry.definition]),
    );
    let definitionPassRan = false;

    if (
      selectedProfile &&
      isScholarLikeMode(selectedProfile.workerMode)
      && (
        bookLexicon?.status !== 'complete'
        || bookLexicon.definitionScanComplete !== true
        || bookLexicon.profileId !== selectedProfile.id
      )
    ) {
      if (settings.scholarAutoScan !== true) {
        throw new Error('Scholar pronunciation and definition scan is required before audiobook generation.');
      }
      const candidates = collectSmartAudioTermCandidates(
        chapters.map((chapter) => chapter.text),
        resolvedPronunciations,
        globalDefinitions,
      );
      definitionPassRan = true;
      try {
        bookLexicon = await resolveSmartAudioBookLexicon({
          profile: selectedProfile,
          candidates,
          existing: bookLexicon?.profileId === selectedProfile.id ? bookLexicon : null,
          onProgress: (partial) => writeBookLexicon(userId, doc.id, partial),
          onUsage: ({ model, batch, tokens }) => {
            serverLogger.info({
              event: 'audiobook.queue.gemini.usage',
              jobId: job.id,
              bookId,
              chapter: null,
              model,
              pass: 'pronunciation_definition_scan',
              batch,
              tokens,
            }, 'Recorded Gemini pronunciation and definition token usage.');
          },
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (/\bHTTP (429|503)\b/.test(message)) {
          await updateClaimedAudiobookJob(job.id, 'running', {
            status: 'queued',
            createdAt: Date.now(),
            updatedAt: Date.now(),
            error: GEMINI_RATE_LIMIT_PAUSE_MESSAGE,
          });
          serverLogger.warn({
            event: 'audiobook.queue.scholar_lexicon.rate_limit',
            bookId,
          }, 'Pronunciation and definition auto-scan paused by Gemini API limits.');
          return;
        }
        throw error;
      }
      await writeBookLexicon(userId, doc.id, bookLexicon);

      const termsNeedingGeneratedPronunciations = new Set(
        candidates
          .filter((candidate) => !candidate.pronunciation)
          .map((candidate) => candidate.term),
      );
      const selectedDefaults = Object.fromEntries(
        Object.values(bookLexicon.entries)
          .filter((entry) => termsNeedingGeneratedPronunciations.has(entry.term))
          .map((entry) => [entry.term, entry.pronunciation]),
      );
      const mergedProfile = await mergeGeneratedPronunciationsIntoLatestProfile(
        userId,
        selectedProfile.id,
        selectedDefaults,
        pronunciationsAtAutoScanStart,
      );
      selectedProfile = mergedProfile?.profile || selectedProfile;
      resolvedPronunciations = filterKokoroCompatiblePronunciationRecord({
        ...globalPronunciations,
        ...(selectedProfile.pronunciations || {}),
      });
      const resolvedGlobalDefinitions = await readGlobalDefinitions();
      for (const [term, definition] of Object.entries(resolvedGlobalDefinitions)) {
        const entry = bookLexicon.entries[term];
        if (entry && !entry.definition && entry.definitionOmitted !== true) {
          entry.definition = definition;
          entry.definitionOmitted = false;
        }
      }
      await mergeGlobalDefinitions(Object.fromEntries(
        Object.entries(bookLexicon.entries)
          .filter(([term, entry]) => (
            Boolean(entry.definition)
            && entry.definitionOmitted !== true
            && !definitionsBeforeAutoScan.get(term)
          ))
          .map(([term, entry]) => [term, entry.definition]),
      ));
      await writeBookLexicon(userId, doc.id, bookLexicon);
      serverLogger.info({
        event: 'audiobook.queue.scholar_lexicon.completed',
        bookId,
        terms: Object.keys(bookLexicon.entries).length,
        pronunciationsApplied: mergedProfile?.appliedWords.length || 0,
        userEditsPreserved: mergedProfile?.preservedUserEdits.length || 0,
      }, 'Built the Scholar pronunciation and definition lexicon before cleanup.');
    }

    let multiVoiceCharacters: MultiVoiceCastMember[] = [];
    if (selectedProfile?.workerMode === MULTI_VOICE_WORKER_MODE) {
      const readiness = getCharacterMapReadiness(resolvedDocumentSettings.smartAudioCharacters);
      if (!readiness.ready || readiness.map?.profileId !== selectedProfile.id) {
        serverLogger.info({ event: 'audiobook.queue.multivoice.waiting_for_voices', bookId }, 'Job is paused waiting for user to map voices in UI');
        await updateClaimedAudiobookJob(job.id, 'running', {
          status: WAITING_FOR_VOICES_STATUS,
          error: 'Review and assign the LitRPG character voices to continue.',
          updatedAt: Date.now(),
        });
        return;
      }
      multiVoiceCharacters = buildMultiVoiceCast(readiness.map);
    }

    serverLogger.info({
      event: 'audiobook.queue.smart_audio.plan',
      jobId: job.id,
      bookId,
      worker_mode: selectedProfile?.workerMode || 'standard',
      nats_subject: useSmartAudio
        ? selectedProfile?.workerMode === MULTI_VOICE_WORKER_MODE
          ? 'audiobooks.multivoice.assign'
          : isScholarLikeMode(selectedProfile?.workerMode)
            ? SCHOLAR_NATS_SUBJECT
            : SMART_AUDIO_NATS_SUBJECT
        : null,
      definition_pass_ran: definitionPassRan,
      definitions_found: Object.values(bookLexicon?.entries || {})
        .filter((entry) => Boolean(entry.definition)).length,
      toc_sections_skipped: tocSectionsSkipped,
      cleanup_target_characters: cleanupTargetCharacters,
    }, 'Prepared audiobook cleanup plan.');

    let nc: import("nats").NatsConnection | null = null;
    let sc: import("nats").Codec<string> | null = null;
    if (useSmartAudio) {
      try {
        const { connect, StringCodec } = await import('nats');
        serverLogger.info({ event: 'audiobook.queue.smart_audio.init', bookId }, 'Connecting to NATS for Gemini worker...');
        const natsUrl = process.env.NATS_URL || "nats://127.0.0.1:4222";
        nc = await connect({ servers: natsUrl, maxReconnectAttempts: 1, timeout: 2000 });
        sc = StringCodec();
      } catch (e) {
        serverLogger.warn({ event: 'audiobook.queue.smart_audio.error', error: e }, 'Failed to connect to NATS, smart audio will fail');
      }
    }
    if (useSmartAudio && (!nc || !sc)) {
      throw new Error('Smart Audio was enabled, but the cleanup worker connection could not be established.');
    }

    let continuityState = "Beginning of book.";

    for (const chapter of chapters) {
      // ABORT CHECK: If user cancelled/deleted the job from the UI, abort processing
      if (!await workerStillOwnsAudiobookJob(job.id)) {
        serverLogger.info({ event: 'audiobook.queue.aborted', jobId: job.id }, 'Job was paused, cancelled, or deleted. Aborting worker loop.');
        if (nc) await nc.close();
        return;
      }

      if (!chapter.text.trim()) continue;

      // CRASH RECOVERY: Check if chapter already exists in DB
      const existing = await db.select().from(audiobookChapters).where(and(eq(audiobookChapters.bookId, bookId), eq(audiobookChapters.userId, userId), eq(audiobookChapters.chapterIndex, chapter.index)));
      if (existing.length > 0) {
        processedLength += chapter.text.length;
        await updateProgress(Math.floor((processedLength / totalLength) * 100));
        continue;
      }

      let processedTextForTts = chapter.text;
      

      if (useSmartAudio && nc && sc) {
        const smartAudioProfileId = String(settings.smartAudioProfileId || '');
        const currentProfilesDocument = await readSmartAudioProfilesDocument(userId);
        const currentSelectedProfile = findSmartAudioProfileById(currentProfilesDocument, smartAudioProfileId);
        
        try {
          serverLogger.info({ event: 'audiobook.queue.smart_audio.enabled', bookId, chapter: chapter.index }, 'Triggering Python Gemini worker...');
          
          // Key is stored per-profile; fall back to empty string which causes
          // the Python worker to return {status:"error"} and skip smart audio.
          const geminiApiKey = (currentSelectedProfile?.geminiApiKey || '').trim();

          const backupGeminiApiKey = (currentSelectedProfile?.backupGeminiApiKey || '').trim();
          const currentPronunciations = filterKokoroCompatiblePronunciationRecord({
            ...globalPronunciations,
            ...pronunciationsFromBookLexicon(bookLexicon),
            ...(currentSelectedProfile?.pronunciations || {}),
          });
          const enrichedChapterText = enrichTextFromBookLexicon(
            chapter.cleanupText ?? chapter.text,
            bookLexicon,
            {
              // scholarIncludeDefinitions defaults to true when absent to preserve existing Scholar behavior
              includeDefinitions: isScholarLikeMode(currentSelectedProfile?.workerMode)
                && ((settings as Record<string, unknown>).scholarIncludeDefinitions !== false),
              pronunciationOverrides: currentPronunciations,
            },
          );
          const applicablePronunciations = selectPronunciationsForText(
            enrichedChapterText,
            currentPronunciations,
          );
          const cleanupSourceText = chapter.cleanupText ?? chapter.text;
          const confirmedEndMatter = hasConfirmedSmartAudioEndMatterHint(cleanupSourceText);

          let payload: string;
          let natsSubject: string;

          if (currentSelectedProfile?.workerMode === MULTI_VOICE_WORKER_MODE) {
            payload = JSON.stringify({
              backup_api_key: backupGeminiApiKey,
              user_id: userId,
              api_key: geminiApiKey,
              ai_model: resolveCleanupAiModel(currentSelectedProfile),
              ai_model_fallbacks: resolveCleanupAiModels(currentSelectedProfile).slice(1),
              raw_text: enrichedChapterText,
              characters: multiVoiceCharacters,
              continuity_state: continuityState,
              pronunciations: applicablePronunciations,
              pronunciation_prompt: buildKokoroPronunciationInstructions(currentSelectedProfile),
              final_cleanup_rules: FINAL_SMART_AUDIO_PRONUNCIATION_CHECK,
            });
            natsSubject = 'audiobooks.multivoice.assign';
          } else {
            payload = JSON.stringify({
              backup_api_key: backupGeminiApiKey,
              user_id: userId,
              api_key: geminiApiKey,
              ai_model: resolveCleanupAiModel(currentSelectedProfile),
              ai_model_fallbacks: resolveCleanupAiModels(currentSelectedProfile).slice(1),
              prompt: buildSmartAudioCleanupPrompt(currentSelectedProfile?.customTtsPrompt),
              final_cleanup_rules: FINAL_SMART_AUDIO_PRONUNCIATION_CHECK,
              pronunciation_prompt: buildKokoroPronunciationInstructions(currentSelectedProfile),
              raw_text: enrichedChapterText,
              pronunciations: applicablePronunciations,
              abbreviations: currentSelectedProfile?.abbreviations || {},
              books: currentSelectedProfile?.books || {}
            });
            natsSubject = isScholarLikeMode(currentSelectedProfile?.workerMode)
              ? SCHOLAR_NATS_SUBJECT
              : SMART_AUDIO_NATS_SUBJECT;
          }

          const msg = await nc.request(natsSubject, sc.encode(payload), {
            timeout: resolveSmartAudioNatsTimeoutMs(currentSelectedProfile?.workerMode),
          });
          if (!await workerStillOwnsAudiobookJob(job.id)) throw new AudiobookJobStoppedError();
          const applyAuthoritativeBookTags = (value: unknown): unknown => {
            if (
              currentSelectedProfile?.workerMode === MULTI_VOICE_WORKER_MODE
              || !bookLexicon
              || !value
              || typeof value !== 'object'
              || Array.isArray(value)
            ) return value;
            const result = value as Record<string, unknown>;
            if (typeof result.cleaned_text !== 'string') return value;
            return {
              ...result,
              cleaned_text: enrichTextFromBookLexicon(result.cleaned_text, bookLexicon, {
                includeDefinitions: false,
                pronunciationOverrides: currentPronunciations,
              }),
            };
          };
          let workerResult = applyAuthoritativeBookTags(JSON.parse(sc.decode(msg.data))) as Record<string, unknown>;

          if (workerResult.status === "rate_limit") {
            serverLogger.warn({ event: 'audiobook.queue.smart_audio.rate_limit', bookId }, 'Python worker reported rate limit. Moving job to back of queue.');
            if (nc) await nc.close();
            await updateClaimedAudiobookJob(job.id, 'running', {
              status: 'queued',
              createdAt: Date.now(),
              updatedAt: Date.now(),
              error: GEMINI_RATE_LIMIT_PAUSE_MESSAGE,
            });
            return;
          }

          if (workerResult.status === "success") {
            const recovery = await resolveSmartAudioWithValidationRecovery({
              initialResult: workerResult,
              authoritativePronunciations: currentPronunciations,
              resolve: (candidate) => {
                const multiVoiceResult = currentSelectedProfile?.workerMode === MULTI_VOICE_WORKER_MODE
                  ? resolveMultiVoiceWorkerResult(candidate, multiVoiceCharacters, {
                    authoritativePronunciations: currentPronunciations,
                    allowUnknownSpeakers: true,
                  })
                  : null;
                const resolvedWorkerResult = multiVoiceResult
                  ? { outcome: 'cleaned' as const, text: multiVoiceResult.taggedText }
                  : resolveSmartAudioWorkerResult(candidate, {
                    authoritativePronunciations: currentPronunciations,
                    allowSubstantialOmission: confirmedEndMatter,
                    sourceText: cleanupSourceText,
                    requirePronunciationTagsForForeignScripts: isScholarLikeSmartAudioMode(currentSelectedProfile?.workerMode),
                  });
                return { multiVoiceResult, resolvedWorkerResult };
              },
              requestRepair: async (rejectedResult, validationError) => {
                const requestedModel = resolveCleanupAiModel(currentSelectedProfile);
                const repairModel = resolveSmartAudioValidationRepairModel(requestedModel);
                serverLogger.warn({
                  event: 'audiobook.queue.smart_audio.validation_repair',
                  jobId: job.id,
                  bookId,
                  chapter: chapter.index,
                  requestedModel,
                  repairModel,
                  error: validationError,
                }, 'Smart Audio output failed validation; requesting one correction with the quality-repair model.');
                const repairMessage = await nc.request(
                  natsSubject,
                  sc.encode(buildSmartAudioValidationRepairPayload(
                    payload,
                    rejectedResult,
                    validationError,
                  )),
                  { timeout: resolveSmartAudioNatsTimeoutMs(currentSelectedProfile?.workerMode) },
                );
                return applyAuthoritativeBookTags(JSON.parse(sc.decode(repairMessage.data)));
              },
              sourceFallback: (rejectedResult) => ({
                ...(rejectedResult && typeof rejectedResult === 'object' && !Array.isArray(rejectedResult)
                  ? rejectedResult as Record<string, unknown>
                  : {}),
                status: 'success',
                outcome: 'cleaned',
                cleaned_text: extractNarratableSmartAudioSourceText(cleanupSourceText),
                changelog: 'Smart Audio repeatedly omitted substantial source text; OpenReader preserved the original narratable text.',
                source_fallback: true,
              }),
            });
            if (!await workerStillOwnsAudiobookJob(job.id)) throw new AudiobookJobStoppedError();
            workerResult = recovery.workerResult;
            const { multiVoiceResult, resolvedWorkerResult } = recovery.result;
            
            if (multiVoiceResult?.unknownSpeakers?.length) {
              serverLogger.warn({ event: 'audiobook.queue.multivoice.unknown_speakers', bookId, speakers: multiVoiceResult.unknownSpeakers }, 'Defaulted unknown speakers to Narrator');
              const [currentDocSettings] = await db
                .select({ dataJson: documentSettings.dataJson })
                .from(documentSettings)
                .where(and(eq(documentSettings.documentId, job.documentId), eq(documentSettings.userId, userId)))
                .limit(1);
              if (currentDocSettings) {
                const currentSettings = typeof currentDocSettings.dataJson === 'string' ? JSON.parse(currentDocSettings.dataJson) : (currentDocSettings.dataJson || {});
                
                const currentMap = currentSettings.smartAudioCharacters || { schemaVersion: 1, status: 'partial', scannedAt: Date.now(), entries: {} };
                let modifiedMap = false;
                for (const unknownName of multiVoiceResult.unknownSpeakers) {
                  if (!currentMap.entries[unknownName]) {
                    currentMap.entries[unknownName] = {
                      name: unknownName,
                      description: `Auto-detected missing speaker: ${unknownName}`,
                      sampleText: '',
                    };
                    modifiedMap = true;
                  }
                }
                
                if (modifiedMap) {
                  currentMap.status = 'partial';
                  currentSettings.smartAudioCharacters = currentMap;
                }
                
                const newFlags = [...(currentSettings.smartAudioReviewFlags || [])];
                newFlags.push({
                  id: randomUUID(),
                  chapterIndex: chapter.index,
                  timestampMs: 0,
                  createdAt: Date.now(),
                });
                currentSettings.smartAudioReviewFlags = newFlags;
                
                await db.update(documentSettings).set({ dataJson: JSON.stringify(currentSettings) }).where(and(eq(documentSettings.documentId, job.documentId), eq(documentSettings.userId, userId)));
              }
            }

            if (recovery.sourceFallbackUsed) {
              serverLogger.warn({
                event: 'audiobook.queue.smart_audio.source_fallback',
                jobId: job.id,
                bookId,
                chapter: chapter.index,
                validationErrors: recovery.validationErrors,
              }, 'Smart Audio repeatedly omitted substantial source text; continuing with the original narratable text.');
            } else if (recovery.fallbackUsed) {
              serverLogger.warn({
                event: 'audiobook.queue.smart_audio.pronunciation_fallback',
                jobId: job.id,
                bookId,
                chapter: chapter.index,
                discardedTags: recovery.discardedTags,
                validationErrors: recovery.validationErrors,
              }, 'Discarded unsafe pronunciation markup after the correction pass; continuing with cleaned text.');
            }
            processedTextForTts = resolvedWorkerResult.text;
            if (multiVoiceResult?.continuityState) {
              continuityState = multiVoiceResult.continuityState;
            } else if (typeof workerResult.continuity_state === 'string' && workerResult.continuity_state.trim()) {
              continuityState = workerResult.continuity_state.trim();
            }
            const resolvedChapterTitle = multiVoiceResult?.chapterTitle
              || (typeof workerResult.chapter_title === 'string' ? workerResult.chapter_title.trim() : '');
            if (resolvedChapterTitle) {
              chapter.title = resolvedChapterTitle;
              await db.update(audiobookChapters)
                .set({ title: resolvedChapterTitle })
                .where(and(eq(audiobookChapters.bookId, bookId), eq(audiobookChapters.chapterIndex, chapter.index)));
            }
            serverLogger.info({
              event: 'audiobook.queue.gemini.usage',
              jobId: job.id,
              bookId,
              chapter: chapter.index,
              requestedModel: resolveCleanupAiModel(currentSelectedProfile),
              model: typeof workerResult.model_used === 'string'
                ? workerResult.model_used
                : resolveCleanupAiModel(currentSelectedProfile),
              pass: 'cleanup',
              worker_mode: currentSelectedProfile?.workerMode || 'standard',
              nats_subject: natsSubject,
              definition_pass_ran: false,
              definitions_found: Object.values(bookLexicon?.entries || {})
                .filter((entry) => Boolean(entry.definition)).length,
              toc_sections_skipped: tocSectionsSkipped,
              tokens: normalizeGeminiTokenUsage(workerResult.usage),
            }, 'Recorded Gemini cleanup token usage.');
            
            if (typeof workerResult.changelog === 'string' && workerResult.changelog) {
              const changelogName = `${String(chapter.index + 1).padStart(4, '0')}__changelog.txt`;
              await putAudiobookObject(bookId, userId, changelogName, Buffer.from(workerResult.changelog, 'utf8'), 'text/plain; charset=utf-8', testNamespace).catch(() => {});
            }
          } else {
            throw new Error(`Python worker returned error: ${workerResult.message || workerResult.status || 'unknown response'}`);
          }
        } catch (e) {
          if (e instanceof AudiobookJobStoppedError) throw e;

          serverLogger.error({ event: 'audiobook.queue.smart_audio.failed', error: e }, 'Smart audio processing failed. Aborting generation.');
          if (nc) await nc.close();
          
          const jobSettingsParsed = typeof job.settingsJson === 'string' ? JSON.parse(job.settingsJson) : (job.settingsJson || {});
          const retries = typeof jobSettingsParsed.smartAudioRetries === 'number' ? jobSettingsParsed.smartAudioRetries : 0;
          
          if (retries < 1) {
            jobSettingsParsed.smartAudioRetries = retries + 1;
            serverLogger.info({ event: 'audiobook.queue.smart_audio.retry_scheduled' }, 'Scheduling auto-retry in 5 minutes...');
            
            await updateClaimedAudiobookJob(job.id, 'running', {
              settingsJson: JSON.stringify(jobSettingsParsed), 
              status: 'error', 
              error: 'Smart audio failed to connect. Will automatically retry in 5 minutes...' 
            });
            
            setTimeout(async () => {
              try {
                // If it's still in error state (user hasn't manually cancelled or requeued it)
                const currentJobCheck = await db.select({ status: audiobookJobs.status }).from(audiobookJobs).where(eq(audiobookJobs.id, job.id));
                if (currentJobCheck.length > 0 && currentJobCheck[0].status === 'error') {
                  serverLogger.info({ event: 'audiobook.queue.smart_audio.auto_requeue' }, 'Auto-requeuing delayed smart audio job...');
                  await db.update(audiobookJobs).set({ status: 'queued', error: null, progress: 0 }).where(eq(audiobookJobs.id, job.id));
                }
              } catch (retryErr) {
                serverLogger.error({ event: 'audiobook.queue.smart_audio.auto_requeue.error', error: retryErr }, 'Failed to auto-requeue job');
              }
            }, 5 * 60 * 1000);
            
            return;
          }
          
          throw new Error(`Smart audio processing failed after auto-retry. Error: ${(e as any).message || e}. Job aborted so it can be requeued later.`);
        }
      }
      
      // ABORT END-MATTER: If Gemini confirmed this was end-matter and omitted it!
      const cleanedTrimmed = processedTextForTts.trim();
      const cleanupSource = chapter.cleanupText ?? chapter.text;
      if (!cleanedTrimmed && cleanupSource.includes('end-matter (e.g. bibliography')) {
          serverLogger.info({ event: 'audiobook.queue.smart_audio.end_matter_confirmed', bookId }, 'Gemini confirmed end-matter and omitted it. Halting generation for the rest of the book!');
          break; // Stop generating the rest of the book!
      }
      
      // If the text is empty but it wasn't end-matter (e.g. just a blank page or copyright), we skip TTS but continue to next chapter
      if (!cleanedTrimmed) {
          continue;
      }
      processedTextForTts = validateSmartAudioOutput(processedTextForTts, {
        requirePronunciationTagsForForeignScripts: isScholarLikeSmartAudioMode(selectedProfile?.workerMode),
      });

      // Smart Audio may replace the inherited layout heading with a concise
      // title for this cleanup batch. Encode the file only after that title is
      // known so blob discovery and the chapter database agree.
      const chapterFileName = encodeChapterFileName(chapter.index, chapter.title, format);

      const ttsBuffer = await generateSegmentedAudiobookTtsBuffer({
        text: processedTextForTts,
        voice: settings.voice || 'alloy',
        speed: settings.speed || 1,
        format: 'mp3',
        provider: creds.provider,
        apiKey: creds.apiKey,
        baseUrl: creds.baseUrl,
        testNamespace: testNamespace,
      });
      if (!await workerStillOwnsAudiobookJob(job.id)) throw new AudiobookJobStoppedError();

      const contentType = format === 'mp3' ? 'audio/mpeg' : 'audio/mp4';
      totalBytes += ttsBuffer.length;
      await putAudiobookObject(bookId, userId, chapterFileName, ttsBuffer, contentType, testNamespace);
      
      // Save the cleaned text so the user can review and edit it later in the new listen UI
      const textFileName = `${String(chapter.index + 1).padStart(4, '0')}__text.txt`;
      await putAudiobookObject(bookId, userId, textFileName, Buffer.from(processedTextForTts, 'utf8'), 'text/plain; charset=utf-8', testNamespace).catch(() => {});
      
      // Save the original text so the user can see what Gemini changed
      const originalFileName = `${String(chapter.index + 1).padStart(4, '0')}__original.txt`;
      await putAudiobookObject(bookId, userId, originalFileName, Buffer.from(chapter.text, 'utf8'), 'text/plain; charset=utf-8', testNamespace).catch(() => {});

      let duration = 0;
      try {
        const { tmpdir } = await import('os');
        const { join } = await import('path');
        const { writeFile, rm } = await import('fs/promises');
        const { ffprobeAudio } = await import('@/lib/server/audiobooks/chapters');
        const tmpPath = join(tmpdir(), 'worker-probe-' + randomUUID() + '.mp3');
        await writeFile(tmpPath, ttsBuffer);
        const probe = await ffprobeAudio(tmpPath);
        duration = probe.durationSec || 0;
        await rm(tmpPath).catch(() => {});
      } catch (e) {
        serverLogger.warn({ event: 'audiobook.queue.probe.failed', error: String(e) }, 'Failed to probe duration');
      }

      try {
        await db.insert(audiobookChapters).values({
          id: randomUUID(),
          bookId,
          userId,
          chapterIndex: chapter.index,
          title: chapter.title,
          duration,
          filePath: chapterFileName,
          format,
        });
      } catch (insertErr: unknown) {
        if (insertErr instanceof Error && insertErr.message.includes('FOREIGN KEY')) {
          serverLogger.info({ event: 'audiobook.queue.aborted', jobId: job.id }, 'Audiobook deleted during chapter generation, aborting.');
          if (nc) await nc.close();
          await db.delete(audiobookJobs).where(eq(audiobookJobs.id, job.id)).catch(() => {});
          return;
        }
        throw insertErr;
      }

      processedLength += chapter.text.length;
      await updateProgress(Math.floor((processedLength / totalLength) * 100));
    }

    if (nc) await nc.close();

    await updateClaimedAudiobookJob(job.id, 'running', {
      status: 'completed',
      completedAt: Date.now(),
      progress: 100,
    });
    await db.update(audiobooks).set({ totalBytes }).where(and(eq(audiobooks.id, bookId), eq(audiobooks.userId, userId)));
    serverLogger.info({ event: 'audiobook.queue.complete', jobId: job.id, documentId: job.documentId }, `Successfully completed audiobook job ${job.id}`);

    // Fire-and-forget internal request to pre-compile the .m4b so the user doesn't have to wait
    const baseUrl = process.env.BASE_URL || `http://127.0.0.1:${process.env.PORT || 3003}`;
    fetch(`${baseUrl}/api/audiobook?bookId=${bookId}&format=m4b&userId=${userId}`, {
      method: 'POST',
      headers: { 'x-internal-secret': INTERNAL_WORKER_SECRET }
    }).catch((e) => {
      serverLogger.warn({ event: 'audiobook.queue.precompile.error', error: String(e) }, 'Failed to trigger background m4b compilation');
    });

  } catch (err: unknown) {
    if (err instanceof AudiobookJobStoppedError) {
      serverLogger.info({ event: 'audiobook.queue.stopped', jobId: job.id }, 'Worker stopped after the job changed state.');
      return;
    }
    const errorMsg = err instanceof Error ? err.message : String(err);
    
    // Auto-requeue transient connectivity crashes (like server reloads or NATS timeouts)
    if (errorMsg.includes('terminated') || errorMsg.includes('fetch failed') || errorMsg.includes('timeout')) {
      serverLogger.warn({ event: 'audiobook.queue.process.requeue', error: errorMsg }, 'Transient error detected, moving job to back of queue.');
      await updateAudiobookJobIfStatus(job.id, 'running', { status: 'queued', createdAt: Date.now() });
      return;
    }
    
    serverLogger.error({ event: 'audiobook.queue.process.error', error: err instanceof Error ? err.stack : String(err) }, 'Error processing audiobook queue');
    await markError(errorMsg);
  }
}
