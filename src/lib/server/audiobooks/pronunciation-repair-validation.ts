import { assertPronunciationRepair } from '@/lib/shared/pronunciation-issues';
import { validateSmartAudioOutput } from '@/lib/shared/smart-audio-cleanup';
import { getAudiobookObjectBuffer } from './blobstore';

/** Recheck source evidence at approval and recording, never trust an AI claim. */
export async function assertStoredPronunciationRepair(input: {
  bookId: string; userId: string; fileName: string; previous: string; proposed: string; allowSourceEvidenceOverride?: boolean; overrideIssueIds?: string[]; allowFullManualOverride?: boolean;
}) {
  if (input.allowFullManualOverride) {
    const previousVoices = input.previous.match(/<\/?voice\b[^>]*>/gu) || [];
    const proposedVoices = input.proposed.match(/<\/?voice\b[^>]*>/gu) || [];
    if (JSON.stringify(previousVoices) !== JSON.stringify(proposedVoices)) {
      throw new Error('A pronunciation-repair override cannot change speaker assignments.');
    }
    validateSmartAudioOutput(input.proposed, { requirePronunciationTagsForForeignScripts: true });
    return;
  }
  if (input.allowSourceEvidenceOverride || input.overrideIssueIds?.length) {
    const ids = new Set(input.overrideIssueIds || []);
    const allow = input.overrideIssueIds?.length
      ? (issue: { id: string }) => ids.has(issue.id)
      : true;
    assertPronunciationRepair(input.previous, input.proposed, { allowSourceEvidenceOverride: allow });
    return;
  }
  try { assertPronunciationRepair(input.previous, input.proposed); return; }
  catch (error) {
    if (!(error instanceof Error) || !error.message.includes('English')) throw error;
  }
  const prefix = input.fileName.split('__')[0];
  let sourceText: string;
  if (input.fileName.endsWith('__rejected.txt')) {
    const metadata = JSON.parse((await getAudiobookObjectBuffer(input.bookId, input.userId, `${prefix}__pronunciation_failure.json`, null)).toString('utf8'));
    sourceText = typeof metadata.sourceText === 'string' ? metadata.sourceText : '';
  } else {
    sourceText = (await getAudiobookObjectBuffer(input.bookId, input.userId, `${prefix}__original.txt`, null)).toString('utf8');
  }
  assertPronunciationRepair(input.previous, input.proposed, { sourceText });
}
