import { randomUUID } from 'node:crypto';

import { and, eq } from 'drizzle-orm';
import * as Diff from 'diff';

import { db } from '@/db';
import { adminSettings, audiobookChapters, audiobookJobs, documents } from '@/db/schema';
import {
  calculateBatchRefineMetrics,
  parseBatchRefineAssessment,
} from '@/lib/server/audiobooks/batch-refine-assessment';
import { prepareScholarBatchRefineText } from '@/lib/server/audiobooks/batch-refine-scholar-safety';
import {
  approveBatchRefineChange,
  createBatchRefineRun,
  finishBatchRefineRun,
  getBatchRefineProposalForChapter,
  getBatchRefineRunState,
  insertBatchRefineProposal,
  markBatchRefineRunStarted,
  updateBatchRefineRunProgress,
} from '@/lib/server/audiobooks/batch-refine-review-store';
import {
  getAudiobookObjectBuffer,
  listAudiobookObjects,
  putAudiobookObject,
} from '@/lib/server/audiobooks/blobstore';
import { fetchGeminiWithRateLimitFallback } from '@/lib/server/smart-audio/gemini-failover';
import {
  findSmartAudioProfileById,
  readSmartAudioProfilesDocument,
} from '@/lib/server/smart-audio-profiles';
import { globalPronunciationDefaults } from '@/lib/server/tts/global-pronunciation-library';
import { runTaskNow } from '@/lib/server/tasks/engine';
import { errorToLog, serverLogger } from '@/lib/server/logger';
import {
  batchRefineAssessmentPrompt,
  normalizeBatchRefineRecordingMode,
  resolveBatchRefineProfileCategory,
  type BatchRefineProfileCategory,
} from '@/lib/shared/batch-refine-review';
import { filterKokoroCompatiblePronunciationRecord } from '@/lib/shared/kokoro-pronunciation-policy';

type BatchRefineJobSettings = {
  jobType?: string;
  rule?: string;
  aiModel?: string;
  batchRefineRunId?: string;
  smartAudioProfileId?: string;
  profileCategory?: BatchRefineProfileCategory;
  recordingMode?: unknown;
  holdHighPriority?: boolean;
};

function parseJobSettings(value: unknown): BatchRefineJobSettings {
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === 'object' ? parsed as BatchRefineJobSettings : {};
    } catch {
      return {};
    }
  }
  return value && typeof value === 'object' ? value as BatchRefineJobSettings : {};
}

function chapterIndexFromTextFile(fileName: string): number | null {
  const match = /^(\d{1,6})__text\.txt$/u.exec(fileName);
  if (!match) return null;
  const oneBased = Number(match[1]);
  return Number.isInteger(oneBased) && oneBased > 0 ? oneBased - 1 : null;
}

async function readOptionalChangelog(bookId: string, userId: string, fileName: string): Promise<string> {
  try {
    return (await getAudiobookObjectBuffer(bookId, userId, fileName, null)).toString('utf8');
  } catch {
    return '';
  }
}

async function writeChangelog(bookId: string, userId: string, fileName: string, text: string): Promise<void> {
  await putAudiobookObject(
    bookId,
    userId,
    fileName,
    Buffer.from(text, 'utf8'),
    'text/plain; charset=utf-8',
    null,
  );
}

export async function processBatchRefineJob(
  job: typeof audiobookJobs.$inferSelect,
  updateProgress: (progress: number) => Promise<void>,
  markError: (err: string) => Promise<void>,
) {
  const bookId = job.documentId;
  const userId = job.userId;
  const jobSettings = parseJobSettings(job.settingsJson);
  const refineRule = typeof jobSettings.rule === 'string' ? jobSettings.rule.trim() : '';

  if (!refineRule) {
    await markError('Refine rule is missing in job settings');
    return;
  }

  const profilesDocument = await readSmartAudioProfilesDocument(userId);
  const selectedProfileId = jobSettings.smartAudioProfileId || profilesDocument.selectedProfileId;
  const profile = findSmartAudioProfileById(profilesDocument, selectedProfileId);
  const profileCategory = jobSettings.profileCategory
    || resolveBatchRefineProfileCategory(profile);
  const recordingMode = normalizeBatchRefineRecordingMode(jobSettings.recordingMode);
  const holdHighPriority = jobSettings.holdHighPriority !== false;
  const primaryKey = (profile?.geminiApiKey || process.env.GEMINI_API_KEY || '').trim();
  const backupKey = (profile?.backupGeminiApiKey || process.env.BACKUP_GEMINI_API_KEY || '').trim();
  const resolvedModel = jobSettings.aiModel || profile?.pronunciationAiModel || 'gemini-2.5-flash';
  const runId = jobSettings.batchRefineRunId || randomUUID();
  let scholarPronunciations: Record<string, string> = {};
  if (profileCategory === 'scholar') {
    const globalRows = await db.select({ valueJson: adminSettings.valueJson })
      .from(adminSettings)
      .where(eq(adminSettings.key, 'global_pronunciations'))
      .limit(1);
    try {
      scholarPronunciations = filterKokoroCompatiblePronunciationRecord({
        ...globalPronunciationDefaults(globalRows[0]?.valueJson || {}),
        ...(profile?.pronunciations || {}),
      });
    } catch (error) {
      serverLogger.warn({
        event: 'audiobook.batch_refine.pronunciation_library_invalid',
        bookId,
        runId,
        error: errorToLog(error),
      }, 'Batch Refine could not read the Scholar pronunciation library; unresolved bare foreign script will be removed.');
      scholarPronunciations = filterKokoroCompatiblePronunciationRecord(profile?.pronunciations || {});
    }
  }

  if (!jobSettings.batchRefineRunId) {
    await createBatchRefineRun({
      id: runId,
      jobId: job.id,
      userId,
      documentId: bookId,
      profileId: profile?.id || null,
      profileCategory,
      rule: refineRule,
      recordingMode,
      holdHighPriority,
    });
  }

  let runFinished = false;
  try {
    const docRows = await db.select({ id: documents.id }).from(documents).where(and(
      eq(documents.id, bookId),
      eq(documents.userId, userId),
    )).limit(1);
    if (docRows.length === 0) throw new Error('Document not found');
    if (!primaryKey && !backupKey) throw new Error('No Gemini API key is configured for the selected Smart Audio profile.');

    const objects = await listAudiobookObjects(bookId, userId, null);
    // Batch Refine changes only the canonical audiobook text. The immutable
    // `__original.txt` extraction is never submitted to Gemini or overwritten.
    const txtFiles = objects
      .filter((object) => chapterIndexFromTextFile(object.fileName) !== null)
      .sort((left, right) => left.fileName.localeCompare(right.fileName));

    await markBatchRefineRunStarted(runId, txtFiles.length);
    if (txtFiles.length === 0) {
      await updateProgress(100);
      await finishBatchRefineRun(runId, 'completed');
      runFinished = true;
      return;
    }

    const chapterRows = await db.select({
      chapterIndex: audiobookChapters.chapterIndex,
      title: audiobookChapters.title,
    }).from(audiobookChapters).where(and(
      eq(audiobookChapters.bookId, bookId),
      eq(audiobookChapters.userId, userId),
    ));
    const chapterTitles = new Map<number, string>(chapterRows.map((chapter: {
      chapterIndex: number;
      title: string;
    }) => [chapter.chapterIndex, chapter.title]));

    const promptTemplate = [
      'You are a surgical text refinement assistant.',
      'Apply exactly one user-provided cleanup rule to the audiobook text.',
      'Do not proofread, polish, rewrite, summarize, translate, normalize encoding, or change anything outside that rule.',
      'If the rule does not apply, refinedText must match the input text exactly, including leading/trailing whitespace and line breaks.',
      'Return valid JSON matching the supplied schema. Put the complete resulting chapter in refinedText without Markdown fences.',
      '',
      'RULE TO APPLY:',
      refineRule,
      '',
      batchRefineAssessmentPrompt(profileCategory),
      '',
      'TEXT TO REFINE:',
    ].join('\n');

    const runChangelogFileName = `batch_refine_${runId}.diff`;
    let cumulativeChangelog = await readOptionalChangelog(bookId, userId, 'batch_refine_changelog.diff');
    let runChangelog = '';
    const runState = await getBatchRefineRunState(runId, userId);
    let changedChapters = Number(runState?.changedChapters || 0);
    let unchangedChapters = Number(runState?.unchangedChapters || 0);
    let failedChapters = Number(runState?.failedChapters || 0);
    const resumeAtChapter = Math.min(txtFiles.length, Math.max(0, Number(runState?.processedChapters || 0)));

    serverLogger.info({
      event: 'audiobook.batch_refine.start',
      bookId,
      jobId: job.id,
      runId,
      profileCategory,
      recordingMode,
      chapterCount: txtFiles.length,
    }, 'Starting Batch Refine proposal run');

    for (let i = resumeAtChapter; i < txtFiles.length; i += 1) {
      const currentJobRows = await db.select({ status: audiobookJobs.status })
        .from(audiobookJobs)
        .where(eq(audiobookJobs.id, job.id))
        .limit(1);
      if (currentJobRows.length === 0 || currentJobRows[0].status !== 'running') {
        await finishBatchRefineRun(runId, 'cancelled');
        runFinished = true;
        serverLogger.info({
          event: 'audiobook.batch_refine.cancelled',
          bookId,
          jobId: job.id,
          runId,
        }, 'Batch Refine was cancelled');
        return;
      }

      const txtFile = txtFiles[i];
      const chapterIndex = chapterIndexFromTextFile(txtFile.fileName);
      if (chapterIndex === null) continue;

      const existingProposal = await getBatchRefineProposalForChapter({ runId, userId, chapterIndex });
      if (existingProposal) {
        // Recover the narrow crash window where the proposal was saved before
        // the run counter. Never ask Gemini to rewrite an already-saved review.
        changedChapters += 1;
      } else try {
        const previousText = (await getAudiobookObjectBuffer(
          bookId,
          userId,
          txtFile.fileName,
          null,
        )).toString('utf8');
        const preparedInput = profileCategory === 'scholar'
          ? prepareScholarBatchRefineText(previousText, scholarPronunciations)
          : { text: previousText, taggedTerms: [], removedTerms: [] };

        const result = await fetchGeminiWithRateLimitFallback({
          primaryApiKey: primaryKey,
          backupApiKey: backupKey,
          requestedModel: resolvedModel,
          request: (apiKey, requestModel) => fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(requestModel || resolvedModel)}:generateContent?key=${encodeURIComponent(apiKey)}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                contents: [{ role: 'user', parts: [{ text: `${promptTemplate}\n${preparedInput.text}` }] }],
                systemInstruction: {
                  parts: [{
                    text: 'You are a precise deletion and replacement editor. Preserve every character outside the explicit rule and report concise review metadata.',
                  }],
                },
                generationConfig: {
                  temperature: 0.1,
                  responseMimeType: 'application/json',
                  responseSchema: {
                    type: 'OBJECT',
                    required: ['refinedText', 'reviewPriority', 'reviewFlags', 'reviewNote'],
                    properties: {
                      refinedText: { type: 'STRING' },
                      reviewPriority: { type: 'STRING', enum: ['low', 'medium', 'high'] },
                      reviewFlags: { type: 'ARRAY', items: { type: 'STRING' } },
                      reviewNote: { type: 'STRING' },
                    },
                  },
                },
                safetySettings: [
                  { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
                  { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
                  { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
                  { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
                ],
              }),
            },
          ),
        });

        const jsonBody = await result.response.json().catch(() => ({}));
        const responseText = jsonBody?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (typeof responseText !== 'string') {
          const detail = jsonBody?.error?.message || jsonBody?.candidates?.[0]?.finishReason || 'empty response';
          throw new Error(`Gemini returned no text (${String(detail)}).`);
        }

        const assessment = parseBatchRefineAssessment(profileCategory, responseText);
        const safeProposal = profileCategory === 'scholar'
          ? prepareScholarBatchRefineText(assessment.refinedText, scholarPronunciations)
          : { text: assessment.refinedText, taggedTerms: [], removedTerms: [] };
        if (safeProposal.text === previousText) {
          unchangedChapters += 1;
        } else {
          const metrics = calculateBatchRefineMetrics({
            category: profileCategory,
            previousText,
            proposedText: safeProposal.text,
            aiPriority: assessment.reviewPriority,
            aiFlags: assessment.reviewFlags,
            aiNote: assessment.reviewNote,
          });
          const changeId = await insertBatchRefineProposal({
            runId,
            userId,
            documentId: bookId,
            chapterIndex,
            chapterTitle: chapterTitles.get(chapterIndex) || `Chapter ${chapterIndex + 1}`,
            textFileName: txtFile.fileName,
            previousText,
            proposedText: safeProposal.text,
            metrics,
          });
          changedChapters += 1;

          const patch = Diff.createTwoFilesPatch(
            txtFile.fileName,
            txtFile.fileName,
            previousText,
            safeProposal.text,
            'Previous approved text',
            'AI proposal',
          );
          cumulativeChangelog += `${cumulativeChangelog ? '\n\n' : ''}${patch}`;
          runChangelog += `${runChangelog ? '\n\n' : ''}${patch}`;
          await Promise.all([
            writeChangelog(bookId, userId, 'batch_refine_changelog.diff', cumulativeChangelog),
            writeChangelog(bookId, userId, runChangelogFileName, runChangelog),
          ]);

          const shouldApproveImmediately = recordingMode === 'immediate'
            && !(holdHighPriority && metrics.reviewPriority === 'high');
          if (shouldApproveImmediately) {
            await approveBatchRefineChange({ changeId, userId });
            void runTaskNow('process-batch-refine-recordings').catch((error) => {
              serverLogger.warn({
                event: 'audiobook.batch_refine.recording_wake_failed',
                changeId,
                error: errorToLog(error),
              }, 'Could not wake the approved recording queue immediately');
            });
          }
        }
      } catch (error) {
        failedChapters += 1;
        serverLogger.error({
          event: 'audiobook.batch_refine.chapter_failed',
          bookId,
          jobId: job.id,
          runId,
          chapter: txtFile.fileName,
          error: errorToLog(error),
        }, 'Batch Refine could not process one chapter; its approved text was preserved');
      }

      const processedChapters = i + 1;
      await updateBatchRefineRunProgress({
        runId,
        processedChapters,
        changedChapters,
        unchangedChapters,
        failedChapters,
      });
      await updateProgress(Math.floor((processedChapters / txtFiles.length) * 100));
    }

    await finishBatchRefineRun(runId, 'completed');
    runFinished = true;
    serverLogger.info({
      event: 'audiobook.batch_refine.complete',
      bookId,
      jobId: job.id,
      runId,
      changedChapters,
      unchangedChapters,
      failedChapters,
    }, 'Completed Batch Refine proposal run');
  } catch (error) {
    if (!runFinished) await finishBatchRefineRun(runId, 'error').catch(() => {});
    serverLogger.error({
      event: 'audiobook.batch_refine.error',
      bookId,
      jobId: job.id,
      runId,
      error: errorToLog(error),
    }, 'Batch Refine job failed');
    throw error;
  }
}
