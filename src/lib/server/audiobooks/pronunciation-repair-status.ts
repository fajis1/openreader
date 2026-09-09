import { and, desc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { batchRefineChanges, batchRefineRuns } from '@/db/schema';
import { PRONUNCIATION_REPAIR_RULE, scanPronunciationIssues } from '@/lib/shared/pronunciation-issues';
import type { PronunciationRepairStatus } from '@/lib/shared/pronunciation-repair-status';

export async function listPronunciationRepairStatus(bookId: string, userId: string) {
  const rows: (Omit<PronunciationRepairStatus, 'ready' | 'unresolvedCount'> & { proposedText: string })[] = await db.select({
    changeId: batchRefineChanges.id, runId: batchRefineChanges.runId,
    fileName: batchRefineChanges.textFileName, chapterIndex: batchRefineChanges.chapterIndex,
    title: batchRefineChanges.chapterTitle, decision: batchRefineChanges.decision,
    audioStatus: batchRefineChanges.audioStatus, proposedText: batchRefineChanges.proposedText,
  }).from(batchRefineChanges).innerJoin(batchRefineRuns, eq(batchRefineRuns.id, batchRefineChanges.runId)).where(and(
    eq(batchRefineChanges.documentId, bookId), eq(batchRefineChanges.userId, userId),
    eq(batchRefineRuns.rule, PRONUNCIATION_REPAIR_RULE),
  )).orderBy(desc(batchRefineChanges.createdAt), desc(batchRefineChanges.id));
  const seen = new Set<number>();
  return rows.filter(row => {
    if (seen.has(row.chapterIndex)) return false;
    seen.add(row.chapterIndex);
    return true;
  }).map(({ proposedText, ...row }) => {
    const unresolvedCount = row.decision === 'pending' ? scanPronunciationIssues(proposedText).length : 0;
    return { ...row, unresolvedCount, ready: row.decision === 'pending' && unresolvedCount === 0 };
  });
}
