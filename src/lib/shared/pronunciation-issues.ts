import { getKokoroPronunciationQualityWarnings, isKokoroSafePronunciation } from './kokoro-pronunciation-policy';
import { expandScholarEditorialWords, hasSplitScholarEditorialWord } from './scholar-editorial-words';
import { validateSmartAudioOutput } from './smart-audio-cleanup';

export const PRONUNCIATION_REPAIR_RULE = 'pronunciation-repair:v1';
export type PronunciationIssue = {
  id: string;
  start: number;
  end: number;
  text: string;
  context: string;
  reason: string;
  replacement?: string;
};
export type PronunciationPatch = { id: string; replacement: string };
const TAG = /\[([^\]\r\n]+)\]\(\/([^/\r\n]+)\/\)/gu;
const FOREIGN = /[\p{Script=Greek}\p{Script=Hebrew}]/u;

function lookup(word: string, dictionary: Record<string, string>): string | undefined {
  const expanded = expandScholarEditorialWords(word.replace(/\\/gu, ''));
  const ipa = dictionary[expanded];
  return ipa && isKokoroSafePronunciation(expanded, ipa) ? ipa : undefined;
}

export function scanPronunciationIssues(text: string, dictionary: Record<string, string> = {}): PronunciationIssue[] {
  const regions: Array<{ start: number; end: number; reason: string }> = [];
  const add = (start: number, end: number, reason: string) => regions.push({ start, end, reason });
  const tags = [...text.matchAll(TAG)];
  // Mask markup without shifting offsets, so bare-script and punctuation
  // findings refer to the exact saved text and never to an IPA value.
  let masked = text;
  for (const tag of [...tags].reverse()) {
    masked = masked.slice(0, tag.index) + ' '.repeat(tag[0].length) + masked.slice(tag.index + tag[0].length);
    const word = tag[1];
    const expanded = expandScholarEditorialWords(word.replace(/\\/gu, ''));
    const warnings = getKokoroPronunciationQualityWarnings(expanded, `/${tag[2]}/`);
    if (word.includes('\\')) warnings.push('Stray backslash in pronunciation label.');
    if (warnings.length) add(tag.index, tag.index + tag[0].length, warnings.join(' '));
    try { validateSmartAudioOutput(tag[0], { requirePronunciationTagsForForeignScripts: false }); }
    catch { add(tag.index, tag.index + tag[0].length, 'Pronunciation markup cannot be aligned safely.'); }
  }
  // Editorial groups may span a tag, its ending, or multiple tags. Match
  // compact tokens and confirm with the same detector used before recording.
  for (const token of text.matchAll(/[^\s<>]+/gu)) {
    if (hasSplitScholarEditorialWord(token[0])) add(token.index, token.index + token[0].length, 'An editorial word is split across pronunciation tags.');
  }
  for (const match of masked.matchAll(/[\p{Script=Greek}\p{Script=Hebrew}][\p{Script=Greek}\p{Script=Hebrew}\p{Mark}'’]*(?:\([\p{Script=Greek}\p{Script=Hebrew}\p{Mark}]+\)[\p{Script=Greek}\p{Script=Hebrew}\p{Mark}'’]*)*/gu)) {
    add(match.index, match.index + match[0].length, 'Greek or Hebrew is outside a pronunciation tag.');
  }
  for (const match of masked.matchAll(/\(\s*\)|\\+(?=[\p{Script=Greek}\p{Script=Hebrew}])|\[[^\]\r\n]*\]\(\/[^\r\n)]*(?:\)|$)/gu)) {
    // A parenthetical containing masked valid tags is not empty.
    if (/^\(\s*\)$/u.test(match[0]) && !/^\(\s*\)$/u.test(text.slice(match.index, match.index + match[0].length))) continue;
    add(match.index, match.index + match[0].length, 'Empty parentheses, stray escape, or malformed pronunciation markup.');
  }
  regions.sort((a, b) => a.start - b.start || b.end - a.end);
  const merged: typeof regions = [];
  for (const region of regions) {
    const previous = merged.at(-1);
    if (previous && region.start <= previous.end) {
      previous.end = Math.max(previous.end, region.end);
      if (!previous.reason.includes(region.reason)) previous.reason += ` ${region.reason}`;
    } else merged.push({ ...region });
  }
  return merged.map((region, index) => {
    const value = text.slice(region.start, region.end);
    let replacement: string | undefined;
    if (/^\(\s*\)$/u.test(value)) replacement = '';
    else {
      const visible = value.replace(TAG, '$1').replace(/\\/gu, '');
      const expanded = expandScholarEditorialWords(visible);
      const pronunciation = lookup(expanded, dictionary);
      if (pronunciation && !/[\s<>]/u.test(visible)) replacement = `[${visible}](${pronunciation})`;
    }
    return { ...region, id: String(index), text: value, context: text.slice(Math.max(0, region.start - 180), Math.min(text.length, region.end + 180)), ...(replacement !== undefined ? { replacement } : {}) };
  });
}

function visibleEnglish(text: string): string {
  // Even a malformed/unclosed IPA payload is pronunciation data, not prose.
  return text.replace(TAG, '$1').replace(/\[([^\]\r\n]+)\]\(\/[^\r\n)]*(?:\)|$)/gu, '$1').replace(/<[^>]*>/gu, '').match(/\p{Script=Latin}[\p{Script=Latin}\p{Mark}'’-]*|\p{Number}+/gu)?.join(' ') || '';
}

export function applyPronunciationPatches(text: string, issues: PronunciationIssue[], patches: PronunciationPatch[]): string {
  const ids = new Set<string>();
  const byId = new Map(issues.map(issue => [issue.id, issue]));
  const edits = patches.map(patch => {
    const issue = byId.get(patch.id);
    if (!issue || ids.has(patch.id) || typeof patch.replacement !== 'string' || patch.replacement.length > 12000) throw new Error('Invalid or duplicate repair patch.');
    ids.add(patch.id);
    if (/[<>]/u.test(patch.replacement) || /\[(?:SYSTEM|LAYOUT|OMIT|CHAPTER_TITLE)/iu.test(patch.replacement)) throw new Error('Repair must not introduce voice or processing markup.');
    if (visibleEnglish(issue.text) !== visibleEnglish(patch.replacement)) throw new Error('Repair changed unrelated English text.');
    if (text.slice(issue.start, issue.end) !== issue.text) throw new Error('Chapter text changed after scanning.');
    return { ...issue, replacement: patch.replacement };
  }).sort((a, b) => b.start - a.start);
  let result = text;
  for (const edit of edits) result = result.slice(0, edit.start) + edit.replacement + result.slice(edit.end);
  return result;
}

export function assertPronunciationRepair(previous: string, proposed: string): void {
  // Human edits must also stay within the originally flagged regions.
  const issues = scanPronunciationIssues(previous);
  let cursor = 0;
  let proposedCursor = 0;
  for (const issue of issues) {
    const unchanged = previous.slice(cursor, issue.start);
    if (!proposed.startsWith(unchanged, proposedCursor)) throw new Error('Repair changed text outside a flagged passage.');
    proposedCursor += unchanged.length;
    cursor = issue.end;
    const next = issues[issues.indexOf(issue) + 1];
    const anchor = previous.slice(cursor, next?.start ?? previous.length);
    const end = anchor ? proposed.indexOf(anchor, proposedCursor) : proposed.length;
    if (end < 0) throw new Error('Repair changed surrounding chapter text.');
    const replacement = proposed.slice(proposedCursor, end);
    if (visibleEnglish(issue.text) !== visibleEnglish(replacement) || /[<>]/u.test(replacement)) throw new Error('Repair changed English text or speaker assignments.');
    proposedCursor = end;
  }
  if (previous.slice(cursor) !== proposed.slice(proposedCursor)) throw new Error('Repair changed the end of the chapter.');
  if (scanPronunciationIssues(proposed).length) throw new Error('Pronunciation issues remain. Review the proposal before recording.');
  validateSmartAudioOutput(proposed, { requirePronunciationTagsForForeignScripts: FOREIGN.test(previous) });
}

export function canonicalRepairTextFile(fileName: string): string {
  return fileName.replace(/__rejected\.txt$/u, '__text.txt');
}
