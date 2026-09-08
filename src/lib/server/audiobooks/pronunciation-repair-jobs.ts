import { randomUUID } from 'node:crypto';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { db } from '@/db';
import { audiobookJobs } from '@/db/schema';
import { serverLogger } from '@/lib/server/logger';
import { assertPronunciationBookIdle, proposePronunciationRepair } from './pronunciation-repairs';
import { PronunciationRepairError, pronunciationRepairErrorMessage, resolveRepairAiSelection, type RepairAiSelection } from './pronunciation-repair-config';
import type { PronunciationPatch } from '@/lib/shared/pronunciation-issues';
import { putAudiobookObject } from './blobstore';
import type { RepairDiagnostics } from './pronunciation-repair-diagnostics';

export type RepairChapterRequest = { fileName: string; hash: string; manualPatches?: PronunciationPatch[] };
type RepairResult = { fileName: string; runId?: string; unresolvedCount?: number; error?: string; requestId: string; diagnosticsFile?: string; diagnosticsUnavailable?: string };
type RepairJobSettings = RepairAiSelection & { jobType: 'pronunciation-repair'; chapters: RepairChapterRequest[]; results: RepairResult[] };
function settingsOf(job: typeof audiobookJobs.$inferSelect): RepairJobSettings {
  try {
    return (typeof job.settingsJson === 'string' ? JSON.parse(job.settingsJson) : job.settingsJson || {}) as RepairJobSettings;
  } catch { return {} as RepairJobSettings; }
}

export async function listPronunciationRepairJobs(bookId: string, userId: string) {
  const jobs = await db.select().from(audiobookJobs).where(and(eq(audiobookJobs.documentId, bookId), eq(audiobookJobs.userId, userId))).orderBy(desc(audiobookJobs.createdAt));
  return jobs.filter((job: typeof audiobookJobs.$inferSelect) => settingsOf(job)?.jobType === 'pronunciation-repair').slice(0, 20).map((job: typeof audiobookJobs.$inferSelect) => {
    const settings = settingsOf(job);
    return { id: job.id, status: job.status, progress: job.progress, error: job.error, total: settings.chapters.length, results: settings.results || [],
      profileId: settings.profileId, aiModel: settings.aiModel, primaryKeyRef: settings.primaryKeyRef, backupKeyRef: settings.backupKeyRef };
  });
}

export async function queuePronunciationRepairs(input: { bookId: string; userId: string; chapters: RepairChapterRequest[]; requestId: string } & RepairAiSelection) {
  if (!/^[a-f0-9-]{36}$/iu.test(input.requestId)) throw new PronunciationRepairError('Invalid repair request ID.');
  if (!Array.isArray(input.chapters) || !input.chapters.length || input.chapters.length > 2000 || JSON.stringify(input.chapters).length > 2000000) throw new PronunciationRepairError('Select between 1 and 2000 chapters for repair.');
  const files = new Set<string>();
  for (const chapter of input.chapters) {
    if (!chapter || !/^[0-9]{1,6}__(text|rejected)\.txt$/u.test(chapter.fileName) || !/^[a-f0-9]{64}$/u.test(chapter.hash) || files.has(chapter.fileName)) throw new PronunciationRepairError('Invalid or duplicate scanned chapter. Scan again.');
    files.add(chapter.fileName);
    if (chapter.manualPatches !== undefined && (!Array.isArray(chapter.manualPatches) || chapter.manualPatches.some(patch => !patch || typeof patch.id !== 'string' || typeof patch.replacement !== 'string' || patch.replacement.length > 12000))) throw new PronunciationRepairError('Invalid manual patch.');
  }
  const id = input.requestId;
  const existing = await db.select().from(audiobookJobs).where(eq(audiobookJobs.id, id)).limit(1);
  if (existing.length) {
    if (existing[0].userId !== input.userId || existing[0].documentId !== input.bookId || settingsOf(existing[0])?.jobType !== 'pronunciation-repair') throw new PronunciationRepairError('Repair request ID is unavailable.');
    return { jobId: id };
  }
  await assertPronunciationBookIdle(input.bookId, input.userId);
  const { selection } = await resolveRepairAiSelection(input.userId, input);
  const settings: RepairJobSettings = { ...selection, jobType: 'pronunciation-repair', chapters: input.chapters.map(chapter => ({ fileName: chapter.fileName, hash: chapter.hash, manualPatches: chapter.manualPatches })), results: [] };
  await db.insert(audiobookJobs).values({ id, userId: input.userId, documentId: input.bookId, status: 'queued', progress: 0, settingsJson: settings, createdAt: Date.now(), updatedAt: Date.now() });
  serverLogger.info({ event: 'pronunciation.repair.queued', jobId: id, chapterCount: settings.chapters.length, model: selection.aiModel }, 'Pronunciation repairs queued');
  return { jobId: id };
}

export async function stopPronunciationRepairs(bookId: string, userId: string, jobId: string) {
  const rows = await db.select().from(audiobookJobs).where(and(eq(audiobookJobs.id, jobId), eq(audiobookJobs.userId, userId), eq(audiobookJobs.documentId, bookId))).limit(1);
  if (!rows.length || settingsOf(rows[0])?.jobType !== 'pronunciation-repair') throw new PronunciationRepairError('Repair job not found.');
  await db.update(audiobookJobs).set({ status: 'paused', updatedAt: Date.now() }).where(and(eq(audiobookJobs.id, jobId), eq(audiobookJobs.userId, userId), inArray(audiobookJobs.status, ['queued', 'running'])));
}

export async function processPronunciationRepairJob(job: typeof audiobookJobs.$inferSelect) {
  const settings = settingsOf(job);
  if (!Array.isArray(settings.chapters)) throw new PronunciationRepairError('Repair job settings are invalid. Queue a new repair job.');
  const controller = new AbortController();
  let checking = false;
  const ownedWhere = and(eq(audiobookJobs.id, job.id), eq(audiobookJobs.userId, job.userId), eq(audiobookJobs.status, 'running'));
  const assertOwned = async () => {
    controller.signal.throwIfAborted();
    const rows = await db.update(audiobookJobs).set({ updatedAt: Date.now() }).where(ownedWhere).returning({ id: audiobookJobs.id });
    if (!rows.length) { controller.abort(); controller.signal.throwIfAborted(); }
  };
  const heartbeat = setInterval(() => {
    if (checking) return;
    checking = true;
    void assertOwned().catch(() => controller.abort()).finally(() => { checking = false; });
  }, 1000);
  try {
    await assertOwned();
    settings.results ||= [];
    for (const chapter of settings.chapters) {
      if (settings.results.some(result => result.fileName === chapter.fileName)) continue;
      await assertOwned();
      const requestId = randomUUID();
      let result: RepairResult;
      let diagnostics: RepairDiagnostics | undefined;
      try {
        const proposal = await proposePronunciationRepair({ ...settings, ...chapter, bookId: job.documentId, userId: job.userId,
          ownJobId: job.id, signal: controller.signal, assertOwned, onDiagnostics: value => { diagnostics = value; } });
        result = { fileName: chapter.fileName, runId: proposal.runId, unresolvedCount: proposal.unresolvedCount, requestId };
      } catch (error) {
        controller.signal.throwIfAborted();
        result = { fileName: chapter.fileName, error: pronunciationRepairErrorMessage(error), requestId };
        // Never log response bodies, book text, URLs containing keys, or credentials.
        serverLogger.warn({ event: 'pronunciation.repair.chapter_failed', jobId: job.id, requestId, chapter: chapter.fileName,
          reason: result.error, errorType: error instanceof Error ? error.name : 'UnknownError' }, 'Pronunciation proposal failed');
      }
      await assertOwned();
      if (diagnostics) {
        const fileName = `pronunciation_repair_${requestId}.json`;
        try {
          await putAudiobookObject(job.documentId, job.userId, fileName, Buffer.from(JSON.stringify(diagnostics)), 'application/json', null);
          result.diagnosticsFile = fileName;
        } catch {
          result.diagnosticsUnavailable = 'Diagnostic storage failed; detailed patches were not retained.';
          serverLogger.warn({ event: 'pronunciation.repair.diagnostics_save_failed', jobId: job.id, requestId }, 'Could not retain pronunciation repair diagnostics');
        }
      }
      settings.results.push(result);
      const updated = await db.update(audiobookJobs).set({ settingsJson: settings, progress: Math.round(settings.results.length / settings.chapters.length * 100), updatedAt: Date.now() }).where(ownedWhere).returning({ id: audiobookJobs.id });
      if (!updated.length) { controller.abort(); controller.signal.throwIfAborted(); }
    }
    const failures = settings.results.filter(result => result.error).length;
    await db.update(audiobookJobs).set({ status: failures ? 'error' : 'completed', error: failures ? `${failures} chapter repairs failed; review individual errors and retry those chapters.` : null,
      progress: 100, completedAt: Date.now(), updatedAt: Date.now() }).where(ownedWhere);
  } catch (error) {
    if (!controller.signal.aborted) throw error;
  } finally { clearInterval(heartbeat); }
}
