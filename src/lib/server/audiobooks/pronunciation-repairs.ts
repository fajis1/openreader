import { randomUUID } from 'node:crypto';
import { and, desc, eq, inArray, ne } from 'drizzle-orm';
import { PronunciationRepairError, resolveRepairAiSelection, type RepairAiSelection } from './pronunciation-repair-config';
import { db } from '@/db';
import { adminSettings, audiobookJobs, audiobookChapters, batchRefineChanges, batchRefineRuns } from '@/db/schema';
import { getAudiobookObjectBuffer, headAudiobookObject, isMissingBlobError, listAudiobookObjects, putAudiobookObject } from './blobstore';
import { batchRefineTextHash, calculateBatchRefineMetrics } from './batch-refine-assessment';
import { createBatchRefineRun, insertBatchRefineProposal, finishBatchRefineRun, updateBatchRefineRunProgress, markBatchRefineRunStarted } from './batch-refine-review-store';
import { readSmartAudioProfilesDocument, findSmartAudioProfileById } from '@/lib/server/smart-audio-profiles';
import { globalPronunciationDefaults } from '@/lib/server/tts/global-pronunciation-library';
import { readBookLexicon } from '@/lib/server/smart-audio/book-lexicon';
import { fetchGeminiWithRateLimitFallback } from '@/lib/server/smart-audio/gemini-failover';
import { resolvePronunciationAiModel } from '@/lib/shared/smart-audio-models';
import { resolveBatchRefineProfileCategory } from '@/lib/shared/batch-refine-review';
import { buildPronunciationRepairInstructions, inspectRepairPatches, sanitizeRepairDiagnostics, PRONUNCIATION_REPAIR_PROMPT_VERSION, type RepairDiagnostics } from './pronunciation-repair-diagnostics';
import { applyPronunciationPatches, assertPronunciationRepair, scanPronunciationIssues, PRONUNCIATION_REPAIR_RULE, type PronunciationPatch } from '@/lib/shared/pronunciation-issues';
import { parseVoiceTaggedText } from '@/lib/shared/multi-voice';

export async function assertPronunciationBookIdle(bookId: string, userId: string, ownJobId?: string): Promise<void> {
  const active = await db.select({ id: audiobookJobs.id }).from(audiobookJobs).where(and(
    eq(audiobookJobs.documentId, bookId), eq(audiobookJobs.userId, userId), inArray(audiobookJobs.status, ['running', 'queued']),
    ownJobId ? ne(audiobookJobs.id, ownJobId) : undefined,
  )).limit(1);
  if (active.length) throw new PronunciationRepairError('Pause background generation before proposing or approving pronunciation repairs.');
}

export async function pronunciationCatalog(bookId: string, userId: string) {
  const objects = await listAudiobookObjects(bookId, userId, null);
  const jobRows = await db.select({ id: audiobookJobs.id, status: audiobookJobs.status, settingsJson: audiobookJobs.settingsJson }).from(audiobookJobs)
    .where(and(eq(audiobookJobs.documentId, bookId), eq(audiobookJobs.userId, userId), inArray(audiobookJobs.status, ['error', 'paused'])));
  const jobs = jobRows.filter((job: { settingsJson?: unknown }) => {
    try {
      const settings = (typeof job.settingsJson === 'string' ? JSON.parse(job.settingsJson) : job.settingsJson) as { jobType?: string } | null;
      return settings?.jobType !== 'pronunciation-repair';
    } catch { return true; }
  }).map((job: { id: string; status: string }) => ({ id: job.id, status: job.status }));
  const chosen = new Map<number, { chapterIndex: number; fileName: string; failed: boolean; modified: number }>();
  for (const object of objects) {
    const match = /^(\d{1,6})__(text|rejected)\.txt$/u.exec(object.fileName);
    if (!match || Number(match[1]) < 1) continue;
    const chapterIndex = Number(match[1]) - 1;
    const candidate = { chapterIndex, fileName: object.fileName, failed: match[2] === 'rejected', modified: object.lastModified };
    const current = chosen.get(chapterIndex);
    if (!current || candidate.modified > current.modified || (candidate.modified === current.modified && !candidate.failed)) chosen.set(chapterIndex, candidate);
  }
  // Keep repaired failures discoverable until the original job resumes, even
  // though approval has already written a newer canonical text object.
  for (const object of objects.filter(item => /^\d{1,6}__rejected\.txt$/u.test(item.fileName))) {
    const index = Number(object.fileName.split('__')[0]) - 1;
    if (chosen.get(index)?.failed) continue;
    const metadataName = object.fileName.replace('__rejected.txt', '__pronunciation_failure.json');
    if (!objects.some(item => item.fileName === metadataName)) continue;
    const metadata = JSON.parse((await getAudiobookObjectBuffer(bookId, userId, metadataName, null)).toString('utf8'));
    if (jobs.some((job: { id: string }) => job.id === metadata.jobId)) chosen.set(index, { chapterIndex: index, fileName: object.fileName, failed: true, modified: object.lastModified });
  }
  return { chapters: [...chosen.values()].sort((a, b) => a.chapterIndex - b.chapterIndex), failedJobs: jobs };
}

export async function existingPronunciationRepair(bookId: string, userId: string, fileName: string, hash: string) {
  const rows = await db.select({ runId: batchRefineChanges.runId, decision: batchRefineChanges.decision, audioStatus: batchRefineChanges.audioStatus })
    .from(batchRefineChanges).innerJoin(batchRefineRuns, eq(batchRefineRuns.id, batchRefineChanges.runId)).where(and(
      eq(batchRefineChanges.userId, userId), eq(batchRefineChanges.documentId, bookId), eq(batchRefineChanges.textFileName, fileName),
      eq(batchRefineChanges.sourceTextHash, hash), eq(batchRefineRuns.rule, PRONUNCIATION_REPAIR_RULE),
      inArray(batchRefineChanges.decision, ['pending', 'approved']),
    )).orderBy(desc(batchRefineChanges.createdAt)).limit(1);
  return rows[0] || null;
}

export async function readPronunciationChapter(bookId: string, userId: string, fileName: string) {
  if (!/^[0-9]{1,6}__(?:text|rejected)\.txt$/u.test(fileName) || Number(fileName.split('__')[0]) < 1) throw new PronunciationRepairError('Invalid chapter text file.');
  // Read exact keys instead of listing the entire book again for each chapter.
  const readBounded = async (name: string, optional = false): Promise<string> => {
    try {
      const head = await headAudiobookObject(bookId, userId, name, null);
      if (head.contentLength > 1000000) throw new PronunciationRepairError('Chapter unavailable or too large for targeted repair.');
      const buffer = await getAudiobookObjectBuffer(bookId, userId, name, null);
      if (buffer.length > 1000000) throw new PronunciationRepairError('Chapter grew beyond the targeted repair limit.');
      return buffer.toString('utf8');
    } catch (error) {
      if (optional && isMissingBlobError(error)) return '';
      throw error;
    }
  };
  const text = await readBounded(fileName);
  const prefix = fileName.split('__')[0];
  const chapterIndex = Number(prefix) - 1;
  const failureName = `${prefix}__pronunciation_failure.json`;
  const failed = fileName.endsWith('__rejected.txt');
  let original = '';
  let jobId: string | undefined;
  let profileId: string | undefined;
  let title = `Chapter ${chapterIndex + 1}`;
  let failureError: string | undefined;
  if (failed) {
    const data = JSON.parse(await readBounded(failureName));
    if (data.rejectedHash !== batchRefineTextHash(text)) throw new PronunciationRepairError('Rejected output changed during capture. Retry the scan.');
    original = typeof data.sourceText === 'string' ? data.sourceText : '';
    jobId = typeof data.jobId === 'string' ? data.jobId : undefined;
    profileId = typeof data.profileId === 'string' ? data.profileId : undefined;
    title = typeof data.chapterTitle === 'string' ? data.chapterTitle : title;
    failureError = Array.isArray(data.errors) && typeof data.errors[0] === 'string' ? data.errors[0] : undefined;
  } else {
    original = await readBounded(`${prefix}__original.txt`, true);
  }
  return { text, original, jobId, profileId, title, chapterIndex, failed, failureError, hash: batchRefineTextHash(text) };
}

export async function pronunciationDictionary(userId: string, bookId: string, requestedProfileId?: string) {
  const profiles = await readSmartAudioProfilesDocument(userId);
  const profile = findSmartAudioProfileById(profiles, requestedProfileId || profiles.selectedProfileId);
  if (!profile) throw new PronunciationRepairError('Select a Smart Audio profile.');
  const rows = await db.select({ valueJson: adminSettings.valueJson }).from(adminSettings).where(eq(adminSettings.key, 'global_pronunciations')).limit(1);
  const lexicon = await readBookLexicon(userId, bookId);
  const bookWords = lexicon?.profileId === profile.id ? Object.fromEntries(Object.entries(lexicon.entries)
    .filter(([, entry]) => entry.pronunciation).map(([word, entry]) => [word, entry.pronunciation!])) : {};
  return { profile, dictionary: { ...globalPronunciationDefaults(rows[0]?.valueJson || {}), ...bookWords, ...profile.pronunciations } };
}

type RepairInput = {
  bookId: string; userId: string; fileName: string; hash: string; profileId?: string; signal: AbortSignal; manualPatches?: PronunciationPatch[];
  ownJobId?: string; assertOwned?: () => Promise<void>;
  onDiagnostics?: (diagnostics: RepairDiagnostics) => void;
} & RepairAiSelection;

export async function proposePronunciationRepair(input: RepairInput) {
  const diagnostics: RepairDiagnostics = { version: 1, promptVersion: PRONUNCIATION_REPAIR_PROMPT_VERSION, stage: 'preparation', sourceHash: input.hash, aiRequested: false };
  const secrets = [process.env.GEMINI_API_KEY || '', process.env.BACKUP_GEMINI_API_KEY || ''];
  try { return await proposePronunciationRepairInternal(input, diagnostics, secrets); }
  finally { input.onDiagnostics?.(sanitizeRepairDiagnostics(diagnostics, secrets)); }
}

async function proposePronunciationRepairInternal(input: RepairInput, diagnostics: RepairDiagnostics, secrets: string[]) {
  input.signal.throwIfAborted();
  await assertPronunciationBookIdle(input.bookId, input.userId, input.ownJobId);
  const chapter = await readPronunciationChapter(input.bookId, input.userId, input.fileName);
  if (chapter.hash !== input.hash) throw new PronunciationRepairError('Chapter changed since scanning. Scan again.');
  const existing = await existingPronunciationRepair(input.bookId, input.userId, input.fileName, chapter.hash);
  if (existing) return { runId: existing.runId, dictionaryRepairs: 0, aiRepairs: 0 };
  const { profile, dictionary } = await pronunciationDictionary(input.userId, input.bookId, input.profileId || chapter.profileId);
  secrets.push(profile.geminiApiKey || '', profile.backupGeminiApiKey || '');
  diagnostics.systemInstruction = buildPronunciationRepairInstructions(profile);
  diagnostics.stage = 'scan';
  const issues = scanPronunciationIssues(chapter.text, dictionary);
  if (!issues.length) throw new PronunciationRepairError('No pronunciation issues remain in this chapter.');
  if ((input.manualPatches || []).some(patch => !patch || typeof patch.id !== 'string' || typeof patch.replacement !== 'string')) throw new PronunciationRepairError('Invalid manual repair.');
  const manual = new Map((input.manualPatches || []).map(patch => [patch.id, patch.replacement]));
  if (manual.size !== (input.manualPatches || []).length || [...manual].some(([id, value]) => !issues.some(issue => issue.id === id) || typeof value !== 'string')) throw new PronunciationRepairError('Invalid manual repair.');
  const resolved = issues.map(issue => ({ ...issue, replacement: manual.has(issue.id) ? manual.get(issue.id) : issue.replacement }));
  const patches: PronunciationPatch[] = resolved.filter(issue => issue.replacement !== undefined).map(issue => ({ id: issue.id, replacement: issue.replacement! }));
  const unresolved = resolved.filter(issue => issue.replacement === undefined);
  const aiIds = new Set(unresolved.map(issue => issue.id));
  diagnostics.findingCount = issues.length;
  diagnostics.findings = inspectRepairPatches(chapter.text, issues, patches, aiIds);
  if (unresolved.length) {
    const { primaryApiKey, backupApiKey, selection } = await resolveRepairAiSelection(input.userId, { ...input, profileId: profile.id });
    secrets.push(primaryApiKey, backupApiKey);
    diagnostics.stage = 'gemini-request';
    diagnostics.requestedModel = selection.aiModel;
    diagnostics.attempts = [];
    if (!primaryApiKey && !backupApiKey) throw new PronunciationRepairError('Configure a Gemini key in the selected profile to repair findings without a dictionary match.');
    const signal = AbortSignal.any([input.signal, AbortSignal.timeout(10 * 60 * 1000)]);
    diagnostics.aiRequested = true;
    const { response, usedModel, usedBackup } = await fetchGeminiWithRateLimitFallback({
      primaryApiKey, backupApiKey, requestedModel: selection.aiModel, signal, maxAttempts: 3,
      request: async (key, model) => {
        const attempt = { model, keyRole: key === primaryApiKey ? 'primary' : 'backup', status: undefined as number | undefined };
        diagnostics.attempts!.push(attempt);
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model || resolvePronunciationAiModel(profile))}:generateContent?key=${encodeURIComponent(key)}`, {
        method: 'POST', signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
          systemInstruction: { parts: [{ text: diagnostics.systemInstruction! }] },
          contents: [{ role: 'user', parts: [{ text: JSON.stringify({ originalSource: chapter.original, chapterContext: chapter.text, findings: unresolved }) }] }],
          generationConfig: { temperature: 0.1, responseMimeType: 'application/json' },
        }),
        });
        attempt.status = response.status;
        return response;
      },
    });
    diagnostics.stage = 'gemini-response';
    diagnostics.httpStatus = response.status;
    diagnostics.usedModel = usedModel;
    diagnostics.usedBackup = usedBackup;
    if (!response.ok) throw new PronunciationRepairError(`Gemini repair failed (HTTP ${response.status}). No chapter text was changed.`);
    let parsed;
    try {
      const body = await response.json();
      if (typeof body.responseId === 'string') diagnostics.responseId = body.responseId;
      if (typeof body.candidates?.[0]?.finishReason === 'string') diagnostics.finishReason = body.candidates[0].finishReason;
      parsed = JSON.parse(body?.candidates?.[0]?.content?.parts?.[0]?.text || '{}');
    } catch {
      throw new PronunciationRepairError(`Gemini returned invalid JSON (HTTP ${response.status}). No chapter text was changed; retry or select another model.`);
    }
    diagnostics.stage = 'patch-coverage';
    const received: PronunciationPatch[] = Array.isArray(parsed?.patches) ? parsed.patches.filter((patch: unknown): patch is PronunciationPatch => Boolean(patch && typeof patch === 'object' && typeof (patch as PronunciationPatch).id === 'string')) : [];
    const receivedIds = received.map(patch => patch.id);
    diagnostics.missingIds = unresolved.filter(issue => !receivedIds.includes(issue.id)).map(issue => issue.id);
    diagnostics.duplicateIds = [...new Set(receivedIds.filter((id, index) => receivedIds.indexOf(id) !== index))];
    diagnostics.unexpectedIds = receivedIds.filter(id => !aiIds.has(id));
    diagnostics.findings = inspectRepairPatches(chapter.text, issues, [...patches, ...received], aiIds);
    if (!Array.isArray(parsed?.patches) || parsed.patches.length !== unresolved.length) throw new PronunciationRepairError('Gemini could not resolve every finding. Enter a replacement for ambiguous findings in the scan results and propose again.');
    const allowed = new Set(unresolved.map(issue => issue.id));
    for (const patch of parsed.patches) {
      if (!patch || !allowed.delete(patch.id) || typeof patch.replacement !== 'string') throw new PronunciationRepairError('Gemini returned an invalid targeted patch.');
      patches.push(patch);
    }
  }
  let proposedText: string;
  diagnostics.findings = inspectRepairPatches(chapter.text, issues, patches, aiIds);
  try {
    diagnostics.stage = 'patch-application';
    proposedText = applyPronunciationPatches(chapter.text, issues, patches);
    diagnostics.stage = 'chapter-validation';
    diagnostics.remainingFindings = scanPronunciationIssues(proposedText).map(({ start, end, text, reason }) => ({ start, end, text, reason }));
    assertPronunciationRepair(chapter.text, proposedText);
  } catch (error) {
    diagnostics.validatorReason = error instanceof Error ? error.message : 'Unknown validator failure';
    throw new PronunciationRepairError('The proposed patches failed pronunciation or unchanged-text validation. Review the flagged passages and enter manual replacements.');
  }
  diagnostics.stage = 'voice-validation';
  try { if (/<voice\b/u.test(proposedText)) parseVoiceTaggedText(proposedText, { includeOmitted: true }); }
  catch (error) { diagnostics.validatorReason = error instanceof Error ? error.message : 'Voice validation failed'; throw error; }
  diagnostics.stage = 'save-proposal';
  input.signal.throwIfAborted();
  await input.assertOwned?.();
  await assertPronunciationBookIdle(input.bookId, input.userId, input.ownJobId);
  if ((await readPronunciationChapter(input.bookId, input.userId, input.fileName)).hash !== chapter.hash) throw new PronunciationRepairError('Chapter changed during repair. Scan again.');
  const runId = randomUUID();
  const category = resolveBatchRefineProfileCategory(profile);
  await createBatchRefineRun({ id: runId, jobId: `repair-${runId}`, userId: input.userId, documentId: input.bookId,
    profileId: profile.id, profileCategory: category, rule: PRONUNCIATION_REPAIR_RULE, recordingMode: 'review', holdHighPriority: true });
  try {
    await markBatchRefineRunStarted(runId, 1);
    const metrics = calculateBatchRefineMetrics({ category, previousText: chapter.text, proposedText, aiPriority: 'high', aiNote: `${patches.length} targeted repairs; ${unresolved.length ? 'Gemini assisted' : 'dictionary/manual/formatting only'}. ${chapter.failed ? 'Rejected generation text; approve to record this chapter, then resume the job.' : 'Existing audio remains until replacement succeeds.'}` });
    await insertBatchRefineProposal({ runId, userId: input.userId, documentId: input.bookId, chapterIndex: chapter.chapterIndex,
      chapterTitle: chapter.title, textFileName: input.fileName, previousText: chapter.text, proposedText,
      metrics,
    });
    await putAudiobookObject(input.bookId, input.userId, `batch_refine_${runId}.diff`, Buffer.from(metrics.diffText), 'text/plain; charset=utf-8', null);
    await updateBatchRefineRunProgress({ runId, processedChapters: 1, changedChapters: 1, unchangedChapters: 0, failedChapters: 0 });
    await finishBatchRefineRun(runId, 'completed');
  } catch (error) { await finishBatchRefineRun(runId, 'error'); throw error; }
  diagnostics.stage = 'complete';
  return { runId, dictionaryRepairs: patches.length - unresolved.length, aiRepairs: unresolved.length };
}

export async function resumeRepairedPronunciationJob(bookId: string, userId: string, fileName: string) {
  const chapter = await readPronunciationChapter(bookId, userId, fileName);
  if (!chapter.jobId) throw new PronunciationRepairError('No resumable background job is associated with this finding.');
  const repairs = await db.select({ id: batchRefineChanges.id, proposedTextHash: batchRefineChanges.proposedTextHash }).from(batchRefineChanges).where(and(
    eq(batchRefineChanges.userId, userId), eq(batchRefineChanges.documentId, bookId), eq(batchRefineChanges.textFileName, fileName),
    eq(batchRefineChanges.sourceTextHash, chapter.hash), eq(batchRefineChanges.decision, 'approved'), eq(batchRefineChanges.audioStatus, 'completed'),
  )).limit(1);
  if (!repairs.length) throw new PronunciationRepairError('Approve the repair and wait for its recording to complete before resuming generation.');
  const canonical = await readPronunciationChapter(bookId, userId, fileName.replace('__rejected.txt', '__text.txt'));
  if (canonical.hash !== repairs[0].proposedTextHash) throw new PronunciationRepairError('Chapter text changed after the repair recording. Review and record the latest text first.');
  const recorded = await db.select({ id: audiobookChapters.id }).from(audiobookChapters).where(and(eq(audiobookChapters.bookId, bookId), eq(audiobookChapters.userId, userId), eq(audiobookChapters.chapterIndex, chapter.chapterIndex))).limit(1);
  if (!recorded.length) throw new PronunciationRepairError('Approve the repair and wait for this chapter to finish recording before resuming generation.');
  await assertPronunciationBookIdle(bookId, userId);
  const updated = await db.update(audiobookJobs).set({ status: 'queued', error: null, updatedAt: Date.now(), startedAt: null })
    .where(and(eq(audiobookJobs.id, chapter.jobId), eq(audiobookJobs.userId, userId), eq(audiobookJobs.documentId, bookId), inArray(audiobookJobs.status, ['error', 'paused']))).returning({ id: audiobookJobs.id });
  if (!updated.length) throw new PronunciationRepairError('The original job is no longer paused or failed.');
  return chapter.jobId;
}
