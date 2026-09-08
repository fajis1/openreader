import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { audiobookJobs } from '@/db/schema';
import { getAudiobookObjectBuffer, headAudiobookObject } from './blobstore';
import { sanitizeRepairDiagnostics, type RepairDiagnostics } from './pronunciation-repair-diagnostics';

export async function pronunciationRepairReport(bookId: string, userId: string, jobId: string) {
  if (!/^[a-f0-9-]{36}$/iu.test(jobId)) return null;
  const rows = await db.select().from(audiobookJobs).where(and(eq(audiobookJobs.id, jobId), eq(audiobookJobs.documentId, bookId), eq(audiobookJobs.userId, userId))).limit(1);
  if (!rows.length) return null;
  const job = rows[0];
  const settings = typeof job.settingsJson === 'string' ? JSON.parse(job.settingsJson) : job.settingsJson;
  if (settings?.jobType !== 'pronunciation-repair') return null;
  type Result = { fileName: string; requestId?: string; runId?: string; unresolvedCount?: number; error?: string; diagnosticsFile?: string; diagnosticsUnavailable?: string; apiBlocked?: boolean; previousAttempts?: { requestId: string; diagnosticsFile?: string }[] };
  const results: Result[] = Array.isArray(settings.results) ? settings.results : [];
  const groups: Record<string, number> = {};
  const chapters = [];
  const readDiagnostics = async (fileName?: string): Promise<RepairDiagnostics | null> => {
    if (!fileName || !/^pronunciation_repair_[a-f0-9-]{36}\.json$/iu.test(fileName)) return null;
    try {
      const head = await headAudiobookObject(bookId, userId, fileName, null);
      if (head.contentLength > 500000) return null;
      const data = await getAudiobookObjectBuffer(bookId, userId, fileName, null);
      if (data.length > 500000) return null;
      return sanitizeRepairDiagnostics(JSON.parse(data.toString('utf8')));
    } catch { return null; }
  };
  for (const result of results) {
    let diagnostics: RepairDiagnostics | undefined;
    let unavailable = result.diagnosticsUnavailable || 'Not retained. This attempt predates detailed diagnostics; its rejected patches and exact validator reason cannot be recovered. Retry explicitly after deploying diagnostic capture.';
    if (result.diagnosticsFile && /^pronunciation_repair_[a-f0-9-]{36}\.json$/iu.test(result.diagnosticsFile)) {
      diagnostics = await readDiagnostics(result.diagnosticsFile) || undefined;
      if (!diagnostics) unavailable = 'Diagnostic artifact could not be read. The saved chapter outcome below is still available.';
    }
    const reason = diagnostics?.validatorReason || result.error;
    const previousAttempts = [];
    for (const attempt of (result.previousAttempts || []).slice(-3)) {
      const previousDiagnostics = await readDiagnostics(attempt.diagnosticsFile);
      previousAttempts.push({ requestId: attempt.requestId, diagnostics: previousDiagnostics,
        ...(!previousDiagnostics ? { diagnosticsUnavailable: 'Previous attempt diagnostics unavailable.' } : {}) });
    }
    if (result.error) groups[reason || 'Unspecified failure'] = (groups[reason || 'Unspecified failure'] || 0) + 1;
    chapters.push({ fileName: result.fileName, requestId: result.requestId, outcome: result.error ? 'failed' : result.runId ? 'proposal_saved' : 'unknown',
      error: result.error, proposalRunId: result.runId, unresolvedCount: result.unresolvedCount, needsReview: Boolean(result.error || result.unresolvedCount || result.apiBlocked),
      recoveryStatus: result.apiBlocked ? 'api_blocked' : result.error ? 'needs_review' : result.unresolvedCount ? 'partial_proposal' : 'complete_proposal',
      previousAttempts, diagnostics: diagnostics || null, ...(!diagnostics ? { diagnosticsUnavailable: unavailable } : {}) });
  }
  return {
    reportVersion: 1, generatedAt: new Date().toISOString(), jobId: job.id, status: job.status, progress: job.progress,
    createdAt: job.createdAt, startedAt: job.startedAt, completedAt: job.completedAt,
    requestedModel: settings.aiModel, profileId: settings.profileId,
    nextAttemptAt: settings.nextAttemptAt,
    summary: { selectedChapters: settings.chapters?.length || 0, processedChapters: results.length, proposals: results.filter(result => result.runId).length,
      completeProposals: results.filter(result => result.runId && !result.unresolvedCount && !result.error && !result.apiBlocked).length,
      apiBlockedChapters: results.filter(result => result.apiBlocked).length,
      unprocessedChapters: Math.max(0, (settings.chapters?.length || 0) - results.length),
      partialProposals: results.filter(result => result.runId && (result.unresolvedCount || result.apiBlocked || result.error)).length, failures: results.filter(result => result.error).length, failureReasons: groups },
    notes: ['Read-only export; no AI calls, reruns, approvals, or audio changes.', 'Contains book excerpts and pronunciation guidance. Review before sharing.', 'Per-finding reasons are isolated checks; the chapter-wide validator reason may indicate a cross-finding or alignment problem.', 'The recorded system instruction excludes the full chapter/source payload. Missing diagnostics cannot be reconstructed retroactively.'],
    chapters,
  };
}
