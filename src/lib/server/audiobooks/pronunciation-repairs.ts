import { randomUUID } from 'node:crypto';
import { and, desc, eq, inArray, ne } from 'drizzle-orm';
import { PronunciationRepairError, pronunciationRepairErrorMessage, resolveRepairAiSelection, type RepairAiSelection } from './pronunciation-repair-config';
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
import { buildPronunciationRepairInstructions, CONTEXTUAL_REPAIR_INSTRUCTIONS, inspectRepairPatches, selectRepairCandidates, sanitizeRepairDiagnostics, PRONUNCIATION_REPAIR_PROMPT_VERSION, type RepairDiagnostics } from './pronunciation-repair-diagnostics';
import { geminiErrorDetails, type GeminiErrorDetails } from '../smart-audio/gemini-error-details';
import { applyPronunciationPatches, assertPronunciationRepair, scanPronunciationIssues, PRONUNCIATION_REPAIR_RULE, type PronunciationPatch } from '@/lib/shared/pronunciation-issues';
import { parseVoiceTaggedText } from '@/lib/shared/multi-voice';
import { serverLogger } from '@/lib/server/logger';

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
  const rows = await db.select({ id: batchRefineChanges.id, runId: batchRefineChanges.runId, decision: batchRefineChanges.decision, audioStatus: batchRefineChanges.audioStatus,
    proposedText: batchRefineChanges.proposedText, proposedTextHash: batchRefineChanges.proposedTextHash, previousText: batchRefineChanges.previousText })
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
  const globalWords = globalPronunciationDefaults(rows[0]?.valueJson || {});
  const provenance = Object.fromEntries([
    ...Object.keys(globalWords).map(word => [word, 'global-dictionary']),
    ...Object.keys(bookWords).map(word => [word, 'book-lexicon']),
    ...Object.keys(profile.pronunciations || {}).map(word => [word, 'profile-dictionary']),
  ]);
  return { profile, dictionary: { ...globalWords, ...bookWords, ...profile.pronunciations }, provenance };
}

type RepairInput = {
  bookId: string; userId: string; fileName: string; hash: string; profileId?: string; signal: AbortSignal; manualPatches?: PronunciationPatch[];
  ownJobId?: string; assertOwned?: () => Promise<void>;
  onDiagnostics?: (diagnostics: RepairDiagnostics) => void;
  retryRunId?: string; proposalHash?: string;
} & RepairAiSelection;

export async function proposePronunciationRepair(input: RepairInput) {
  const diagnostics: RepairDiagnostics = { version: 1, promptVersion: PRONUNCIATION_REPAIR_PROMPT_VERSION, stage: 'preparation', sourceHash: input.hash, aiRequested: false };
  const secrets = [process.env.GEMINI_API_KEY || '', process.env.BACKUP_GEMINI_API_KEY || ''];
  try { return await proposePronunciationRepairInternal(input, diagnostics, secrets); }
  catch (error) {
    diagnostics.validatorReason ||= pronunciationRepairErrorMessage(error);
    diagnostics.errorType = error instanceof PronunciationRepairError ? 'PronunciationRepairError'
      : error instanceof TypeError ? 'TypeError' : error instanceof Error ? 'Error' : 'UnknownError';
    throw error;
  }
  finally { input.onDiagnostics?.(sanitizeRepairDiagnostics(diagnostics, secrets)); }
}

async function proposePronunciationRepairInternal(input: RepairInput, diagnostics: RepairDiagnostics, secrets: string[]) {
  input.signal.throwIfAborted();
  diagnostics.stage = 'book-idle-check';
  await assertPronunciationBookIdle(input.bookId, input.userId, input.ownJobId);
  diagnostics.stage = 'chapter-read';
  const chapter = await readPronunciationChapter(input.bookId, input.userId, input.fileName);
  if (chapter.hash !== input.hash) throw new PronunciationRepairError('Chapter changed since scanning. Scan again.');
  diagnostics.stage = 'proposal-lookup';
  const existing = await existingPronunciationRepair(input.bookId, input.userId, input.fileName, chapter.hash);
  if (input.retryRunId && (!existing || existing.runId !== input.retryRunId || existing.decision !== 'pending'
    || existing.proposedTextHash !== input.proposalHash)) throw new PronunciationRepairError('Proposal changed since scanning. Scan again before retrying unresolved findings.');
  if (existing && !input.retryRunId) return { runId: existing.runId, proposalAction: 'reused' as const, dictionaryRepairs: 0, aiRepairs: 0,
    unresolvedCount: scanPronunciationIssues(existing.proposedText || '').length };
  const baseline = chapter.text;
  if (existing && input.retryRunId) {
    diagnostics.stage = 'existing-proposal-validation';
    try {
      assertPronunciationRepair(baseline, existing.proposedText, { sourceText: chapter.original, allowRemaining: true });
    } catch (error) {
      diagnostics.validatorReason = error instanceof Error ? error.message : 'Existing proposal validation failed.';
      throw new PronunciationRepairError('The saved proposal failed validation before retrying. Review the exact reason in the repair report.');
    }
    chapter.text = existing.proposedText;
  }
  diagnostics.stage = 'profile-selection';
  const { profile, dictionary, provenance } = await pronunciationDictionary(input.userId, input.bookId, input.profileId || chapter.profileId);
  secrets.push(profile.geminiApiKey || '', profile.backupGeminiApiKey || '');
  diagnostics.systemInstruction = `${buildPronunciationRepairInstructions(profile)}\n${CONTEXTUAL_REPAIR_INSTRUCTIONS}`;
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
    diagnostics.fallbackModels = selection.fallbackModels;
    diagnostics.attempts = [];
    if (!primaryApiKey && !backupApiKey) throw new PronunciationRepairError('Configure a Gemini key in the selected profile to repair findings without a dictionary match.');
    const signal = AbortSignal.any([input.signal, AbortSignal.timeout(10 * 60 * 1000)]);
    diagnostics.aiRequested = true;
    let pending = unresolved;
    // One correction request, only for unresolved findings. Good patches stay
    // at their original offsets and are never sent back for regeneration.
    for (let round = 0; round < 2 && pending.length; round += 1) {
    diagnostics.stage = round ? 'gemini-correction' : 'gemini-request';
    try {
    const { response, usedModel, usedBackup } = await fetchGeminiWithRateLimitFallback({
      primaryApiKey, backupApiKey, requestedModel: selection.aiModel, fallbackModels: selection.fallbackModels, signal, maxAttempts: 3,
      request: async (key, model) => {
        const attempt = { model, keyRole: key === primaryApiKey ? 'primary' : 'backup', status: undefined as number | undefined, round: round + 1, errorDetails: undefined as GeminiErrorDetails | undefined };
        diagnostics.attempts!.push(attempt);
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model || resolvePronunciationAiModel(profile))}:generateContent?key=${encodeURIComponent(key)}`, {
        method: 'POST', signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
          systemInstruction: { parts: [{ text: diagnostics.systemInstruction! }] },
          contents: [{ role: 'user', parts: [{ text: JSON.stringify({ originalSource: chapter.original, chapterContext: chapter.text, findings: pending,
            ...(round ? { validationFeedback: diagnostics.findings?.filter(finding => pending.some(issue => issue.id === finding.id)).map(({ id, reasons }) => ({ id, reasons })) } : {}) }) }] }],
          generationConfig: { temperature: 0.1, responseMimeType: 'application/json' },
        }),
        });
        attempt.status = response.status;
        if (!response.ok) attempt.errorDetails = await geminiErrorDetails(response);
        return response;
      },
    });
    diagnostics.stage = 'gemini-response';
    diagnostics.httpStatus = response.status;
    diagnostics.usedModel = usedModel;
    diagnostics.usedBackup = usedBackup;
    if (!response.ok) {
      if ([429, 500, 502, 503, 504].includes(response.status)) {
        diagnostics.apiBlocked = true;
        const retryAfterMs = Math.max(60000, ...diagnostics.attempts!.filter(attempt => attempt.round === round + 1).map(attempt => attempt.errorDetails?.retryAfterMs || 0));
        diagnostics.nextAttemptAt = Date.now() + Math.min(retryAfterMs, Number.MAX_SAFE_INTEGER - Date.now());
      }
      throw new PronunciationRepairError(`Gemini repair failed (HTTP ${response.status}). No chapter text was changed.`);
    }
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
    diagnostics.missingIds = pending.filter(issue => !receivedIds.includes(issue.id)).map(issue => issue.id);
    diagnostics.duplicateIds = [...new Set(receivedIds.filter((id, index) => receivedIds.indexOf(id) !== index))];
    diagnostics.unexpectedIds = receivedIds.filter(id => !pending.some(issue => issue.id === id));
    const candidates = selectRepairCandidates(chapter.text, pending, received.filter(patch => !diagnostics.duplicateIds!.includes(patch.id) && !diagnostics.unexpectedIds!.includes(patch.id)), diagnostics, chapter.original, round + 1);
    diagnostics.findings = inspectRepairPatches(chapter.text, issues, [...patches, ...candidates], aiIds, chapter.original);
    (diagnostics.rounds ||= []).push({ round: round + 1, missingIds: diagnostics.missingIds, duplicateIds: diagnostics.duplicateIds,
      unexpectedIds: diagnostics.unexpectedIds, findings: diagnostics.findings, outcome: 'response_received' });
    for (const patch of candidates) {
      if (diagnostics.findings.find(finding => finding.id === patch.id)?.reasons.length === 0) patches.push(patch);
    }
    pending = pending.filter(issue => !patches.some(patch => patch.id === issue.id));
    } catch (error) {
      input.signal.throwIfAborted();
      if (!(error instanceof PronunciationRepairError) || signal.aborted) {
        diagnostics.apiBlocked = true;
        diagnostics.nextAttemptAt = Date.now() + 60000;
      }
      // Invalid JSON is retried once. Exhausted transport failures do not
      // restart the full transport budget; retain other valid repairs.
      diagnostics.validatorReason = error instanceof PronunciationRepairError ? error.message : 'Gemini request failed after transport retries.';
      (diagnostics.requestErrors ||= []).push({ round: round + 1, reason: diagnostics.validatorReason });
      (diagnostics.rounds ||= []).push({ round: round + 1, outcome: diagnostics.apiBlocked ? 'api_blocked' : 'request_failed' });
      if (!(error instanceof PronunciationRepairError && error.message.includes('invalid JSON')) || round === 1) break;
    }
    }
  }
  let proposedText: string;
  const checks = inspectRepairPatches(chapter.text, issues, patches, aiIds, chapter.original);
  diagnostics.findings = checks.map(finding => ({ ...finding,
    replacement: finding.replacement ?? diagnostics.findings?.find(old => old.id === finding.id)?.replacement,
    dictionaryWord: issues.find(issue => issue.id === finding.id)?.dictionaryWord,
    dictionarySource: provenance[issues.find(issue => issue.id === finding.id)?.dictionaryWord || ''],
    dictionaryPronunciation: dictionary[issues.find(issue => issue.id === finding.id)?.dictionaryWord || ''],
    source: manual.has(finding.id) ? 'manual' : aiIds.has(finding.id) ? 'gemini' : provenance[issues.find(issue => issue.id === finding.id)?.dictionaryWord || ''] || 'formatting',
    reasons: finding.reasons.length && diagnostics.findings?.find(old => old.id === finding.id)?.reasons.length
      ? diagnostics.findings.find(old => old.id === finding.id)!.reasons : finding.reasons,
  }));
  for (const finding of diagnostics.findings) {
    if (!finding.reasons.length) { finding.outcome = 'resolved'; continue; }
    const rejected = diagnostics.candidateChecks?.filter(check => check.id === finding.id && !check.selected);
    if (rejected?.length) {
      finding.outcome = 'candidate_rejected';
      finding.reasons = [...new Set(rejected.flatMap(check => check.reasons))];
      finding.replacement = rejected.at(-1)?.replacement;
      if (finding.reasons.some(reason => reason.includes('source evidence') || reason.includes('unrelated English') && /mixed-script|bare IPA|nested/iu.test(finding.scanReason))) {
        finding.outcome = 'source_evidence_missing';
        finding.reasons.push('No accepted source-supported reconstruction was established.');
      }
    } else if (diagnostics.apiBlocked && aiIds.has(finding.id)) {
      finding.outcome = 'api_blocked';
      finding.reasons = ['No usable replacement obtained because the Gemini request was blocked. This does not establish linguistic ambiguity.'];
    } else finding.outcome = aiIds.has(finding.id) ? 'model_omitted' : 'unresolved_after_validation';
  }
  const validPatches = patches.filter(patch => checks.find(finding => finding.id === patch.id)?.reasons.length === 0);
  if (!validPatches.length) {
    diagnostics.validatorReason ||= diagnostics.findings.find(finding => finding.reasons.length)?.reasons.join(' ');
    throw new PronunciationRepairError(diagnostics.apiBlocked ? 'Gemini API blocked; no usable candidates received for the unresolved findings. Saved proposals are retained.' : diagnostics.validatorReason?.includes('invalid JSON') ? diagnostics.validatorReason : 'No safe repairs were found. Review the unresolved findings in the repair report.');
  }
  try {
    diagnostics.stage = 'patch-application';
    proposedText = applyPronunciationPatches(chapter.text, issues, validPatches, { sourceText: chapter.original });
    diagnostics.stage = 'chapter-validation';
    diagnostics.remainingFindings = scanPronunciationIssues(proposedText).map(({ start, end, text, reason }) => ({ start, end, text, reason }));
    assertPronunciationRepair(chapter.text, proposedText, { sourceText: chapter.original, allowRemaining: true });
    if (!diagnostics.remainingFindings.length) {
      assertPronunciationRepair(chapter.text, proposedText, { sourceText: chapter.original });
      delete diagnostics.validatorReason; // Recovered request errors remain in requestErrors.
    }
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
  if (existing && input.retryRunId) {
    assertPronunciationRepair(baseline, proposedText, { sourceText: chapter.original, allowRemaining: true });
    const metrics = calculateBatchRefineMetrics({ category: resolveBatchRefineProfileCategory(profile), previousText: baseline, proposedText, aiPriority: 'high',
      aiNote: `${diagnostics.remainingFindings?.length || 0} unresolved passages after retry; review before recording.` });
    const updated = await db.update(batchRefineChanges).set({ proposedText, proposedTextHash: metrics.proposedTextHash,
      diffText: metrics.diffText, changedCharacters: metrics.changedCharacters, addedCharacters: metrics.addedCharacters,
      removedCharacters: metrics.removedCharacters, changePercent: metrics.changePercent, flagsJson: metrics.reviewFlags,
      reviewNote: metrics.reviewNote, reviewPriority: metrics.reviewPriority, priorityScore: metrics.priorityScore, updatedAt: Date.now() })
      .where(and(eq(batchRefineChanges.id, existing.id), eq(batchRefineChanges.userId, input.userId), eq(batchRefineChanges.documentId, input.bookId),
        eq(batchRefineChanges.decision, 'pending'), eq(batchRefineChanges.proposedTextHash, input.proposalHash!), eq(batchRefineChanges.sourceTextHash, input.hash)))
      .returning({ id: batchRefineChanges.id });
    if (!updated.length) throw new PronunciationRepairError('Proposal changed during repair. Rescan before retrying.');
    try {
      await putAudiobookObject(input.bookId, input.userId, `batch_refine_${existing.runId}.diff`, Buffer.from(metrics.diffText), 'text/plain; charset=utf-8', null);
    } catch {
      serverLogger.warn({ event: 'pronunciation.repair.diff_refresh_failed', runId: existing.runId }, 'Proposal saved; its downloadable diff could not be refreshed. Review the current proposal comparison.');
    }
    diagnostics.stage = 'complete';
    return { runId: existing.runId, proposalAction: 'updated' as const, dictionaryRepairs: validPatches.filter(patch => !aiIds.has(patch.id)).length,
      aiRepairs: validPatches.filter(patch => aiIds.has(patch.id)).length, unresolvedCount: diagnostics.remainingFindings?.length || 0 };
  }
  const runId = randomUUID();
  const category = resolveBatchRefineProfileCategory(profile);
  await createBatchRefineRun({ id: runId, jobId: `repair-${runId}`, userId: input.userId, documentId: input.bookId,
    profileId: profile.id, profileCategory: category, rule: PRONUNCIATION_REPAIR_RULE, recordingMode: 'review', holdHighPriority: true });
  try {
    await markBatchRefineRunStarted(runId, 1);
    const remaining = diagnostics.remainingFindings?.length || 0;
    const metrics = calculateBatchRefineMetrics({ category, previousText: chapter.text, proposedText, aiPriority: 'high', aiNote: `${remaining ? `NEEDS REVIEW: ${remaining} unresolved passages; recording blocked until corrected. ` : ''}${validPatches.length} targeted repairs; ${unresolved.length ? 'Gemini assisted' : 'dictionary/manual/formatting only'}. Source-supported OCR changes require review. Existing audio remains until replacement succeeds.` });
    await insertBatchRefineProposal({ runId, userId: input.userId, documentId: input.bookId, chapterIndex: chapter.chapterIndex,
      chapterTitle: chapter.title, textFileName: input.fileName, previousText: chapter.text, proposedText,
      metrics,
    });
    await putAudiobookObject(input.bookId, input.userId, `batch_refine_${runId}.diff`, Buffer.from(metrics.diffText), 'text/plain; charset=utf-8', null);
    await updateBatchRefineRunProgress({ runId, processedChapters: 1, changedChapters: 1, unchangedChapters: 0, failedChapters: 0 });
    await finishBatchRefineRun(runId, 'completed');
  } catch (error) { await finishBatchRefineRun(runId, 'error'); throw error; }
  diagnostics.stage = 'complete';
  return { runId, proposalAction: 'created' as const, dictionaryRepairs: validPatches.filter(patch => !aiIds.has(patch.id)).length, aiRepairs: validPatches.filter(patch => aiIds.has(patch.id)).length, unresolvedCount: diagnostics.remainingFindings?.length || 0 };
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
