import { and, desc, eq } from 'drizzle-orm';
import { db } from '@/db';
import { batchRefineChanges, batchRefineRuns, documentSettings } from '@/db/schema';
import { PRONUNCIATION_REPAIR_RULE } from '@/lib/shared/pronunciation-issues';
import { approvedPronunciationCandidates } from '@/lib/shared/remember-approved-pronunciations';
import type { SmartAudioBookLexicon } from '@/types/document-settings';
import { assertPronunciationBookIdle } from './pronunciation-repairs';

export async function rememberApprovedPronunciations(bookId: string, userId: string) {
  await assertPronunciationBookIdle(bookId, userId);
  const changes: { chapterIndex: number; decision: string; previousText: string; proposedText: string; profileId: string | null }[] = await db.select({
    chapterIndex: batchRefineChanges.chapterIndex, decision: batchRefineChanges.decision,
    previousText: batchRefineChanges.previousText, proposedText: batchRefineChanges.proposedText,
    profileId: batchRefineRuns.profileId,
  }).from(batchRefineChanges).innerJoin(batchRefineRuns, eq(batchRefineRuns.id, batchRefineChanges.runId)).where(and(
    eq(batchRefineChanges.documentId, bookId), eq(batchRefineChanges.userId, userId), eq(batchRefineRuns.rule, PRONUNCIATION_REPAIR_RULE),
  )).orderBy(desc(batchRefineChanges.createdAt), desc(batchRefineChanges.id));
  const seen = new Set<number>();
  const latest = changes.filter(change => {
    if (seen.has(change.chapterIndex)) return false;
    seen.add(change.chapterIndex); return change.decision === 'approved';
  });
  for (let attempt = 0; attempt < 4; attempt++) {
    const rows = await db.select({ dataJson: documentSettings.dataJson }).from(documentSettings).where(and(
      eq(documentSettings.documentId, bookId), eq(documentSettings.userId, userId),
    )).limit(1);
    const stored = rows[0]?.dataJson;
    const settings = typeof stored === 'string' ? JSON.parse(stored) : stored || {};
    const existing: SmartAudioBookLexicon | undefined = settings.smartAudioLexicon;
    const profileId = existing?.profileId || latest.find(change => change.profileId)?.profileId;
    if (!profileId) return { saved: 0, alreadyKnown: 0, skipped: 0, message: 'No approved repair profile was found.' };
    const candidates = approvedPronunciationCandidates(latest.filter(change => change.profileId === profileId));
    const entries = { ...existing?.entries };
    let saved = 0, alreadyKnown = 0, skipped = candidates.skipped;
    for (const [term, pronunciation] of Object.entries(candidates.entries)) {
      const current = entries[term];
      if (current) {
        if (current.pronunciation !== pronunciation) { skipped++; continue; }
        if (current.approvedRepair) { alreadyKnown++; continue; }
      }
      entries[term] = { ...current, term, pronunciation, definition: current?.definition ?? null,
        language: /\p{Script=Hebrew}/u.test(term) ? 'biblical_hebrew' : 'koine_greek', approvedRepair: true };
      saved++;
    }
    const result = { saved, alreadyKnown, skipped, profileId };
    if (!saved) return result;
    const lexicon: SmartAudioBookLexicon = { schemaVersion: 1, status: 'partial', definitionScanComplete: false,
      pronunciationModel: 'approved-repair', scannedAt: Date.now(), ...existing, profileId, entries };
    const payload = { ...settings, smartAudioLexicon: lexicon };
    const dataJson = (process.env.POSTGRES_URL ? payload : JSON.stringify(payload)) as never;
    // Compare-and-swap preserves concurrent settings/lexicon edits. Retry from
    // fresh state instead of overwriting someone else's dictionary changes.
    const updated = rows.length
      ? await db.update(documentSettings).set({ dataJson, updatedAt: Date.now() }).where(and(
        eq(documentSettings.documentId, bookId), eq(documentSettings.userId, userId), eq(documentSettings.dataJson, stored as never),
      )).returning({ id: documentSettings.documentId })
      : await db.insert(documentSettings).values({ documentId: bookId, userId, dataJson, clientUpdatedAtMs: 0, updatedAt: Date.now() })
        .onConflictDoNothing().returning({ id: documentSettings.documentId });
    if (updated.length) return result;
  }
  throw new Error('Book settings changed while remembering pronunciations. Please try again.');
}
