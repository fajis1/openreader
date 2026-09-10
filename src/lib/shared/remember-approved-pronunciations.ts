import { isKokoroSafePronunciation } from './kokoro-pronunciation-policy';
import { scanPronunciationIssues } from './pronunciation-issues';

/** Only changed, complete Greek/Hebrew words already printed in the prior text.
 * Explicitly contextual ! tags, suffixes, elision and reconstructed labels are
 * deliberately not promoted into reusable entries. Conflicts stay unlearned. */
export function approvedPronunciationCandidates(changes: { previousText: string; proposedText: string }[]) {
  const choices = new Map<string, Set<string>>();
  let skipped = 0;
  for (const change of changes) {
    const before = change.previousText.normalize('NFC');
    const plainBefore = before.replace(/\[([^\]]+)\]\(!?\/[^/]*\/\)/gu, '$1');
    for (const match of change.proposedText.normalize('NFC').matchAll(/\[([^\]\r\n]+)\]\((!?\/[^/\r\n]+\/)\)/gu)) {
      const [tag, word, pronunciation] = match;
      if (before.includes(tag)) continue;
      const greek = /^[\p{Script=Greek}\p{Mark}]+$/u.test(word);
      const hebrew = /^[\p{Script=Hebrew}\p{Mark}]+$/u.test(word);
      const letters = word.match(/\p{Letter}/gu) || [];
      const sourceWords: string[] = plainBefore.match(/[\p{Letter}\p{Mark}]+/gu) || [];
      if ((!greek && !hebrew) || letters.length < 2 || pronunciation.startsWith('!')
        || !sourceWords.includes(word) || !isKokoroSafePronunciation(word, pronunciation)
        || scanPronunciationIssues(tag).length) { skipped += 1; continue; }
      const values = choices.get(word) || new Set<string>();
      values.add(pronunciation); choices.set(word, values);
    }
  }
  const entries: Record<string, string> = Object.create(null);
  for (const [word, values] of choices) {
    if (values.size === 1) entries[word] = [...values][0];
    else skipped += 1;
  }
  return { entries, skipped };
}
