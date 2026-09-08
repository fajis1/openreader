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
  dictionaryWord?: string;
};
export type PronunciationPatch = { id: string; replacement: string };
const TAG = /\[([^\]\r\n]+)\]\(\/([^/\r\n]+)\/\)/gu;
const FOREIGN = /[\p{Script=Greek}\p{Script=Hebrew}]/u;

function lookup(word: string, dictionary: Record<string, string>): string | undefined {
  const expanded = expandScholarEditorialWords(word.replace(/\\/gu, ''));
  const saved = dictionary[expanded];
  if (!saved || !/^[\p{Letter}\p{Mark}'’]+$/u.test(expanded)) return undefined;
  // Only compact phoneme spacing for a confirmed single word. Never mutate
  // the saved dictionary, or collapse whitespace in a phrase/initialism.
  const ipa = saved.replace(/\s+/gu, '');
  if (!isKokoroSafePronunciation(expanded, ipa)) return undefined;
  try {
    validateSmartAudioOutput(`[${word}](${ipa})`, { requirePronunciationTagsForForeignScripts: false });
    return ipa;
  } catch { return undefined; }
}

export function scanPronunciationIssues(text: string, dictionary: Record<string, string> = {}): PronunciationIssue[] {
  const regions: Array<{ start: number; end: number; reason: string }> = [];
  const add = (start: number, end: number, reason: string) => regions.push({ start, end, reason });
  const tags = [...text.matchAll(TAG)];
  const tagsByStart = new Map(tags.map(tag => [tag.index, tag]));
  // Include incomplete closing delimiters without consuming surrounding prose.
  for (const match of text.matchAll(/\[[^\[\]\r\n]+\]\(\/[^/\r\n]+\/\]/gu)) {
    add(match.index, match.index + match[0].length, 'Malformed pronunciation closing delimiter.');
  }
  for (const match of text.matchAll(/[\p{Letter}\p{Mark}]+/gu)) {
    if (FOREIGN.test(match[0]) && /\p{Script=Latin}/u.test(match[0]) && !tags.some(tag => match.index >= tag.index && match.index < tag.index + tag[0].length)) {
      add(match.index, match.index + match[0].length, 'Mixed-script OCR word requires source-supported reconstruction.');
    }
  }
  // An incomplete bracketed word is one repair region, not bare letters
  // inside retained brackets. Exclude ordinary Markdown links.
  for (const match of text.matchAll(/\[[\p{Script=Greek}\p{Script=Hebrew}\p{Mark}()'’]+\](?!\()/gu)) {
    add(match.index, match.index + match[0].length, 'Foreign word has brackets but no pronunciation.');
  }
  // Mask markup without shifting offsets, so bare-script and punctuation
  // findings refer to the exact saved text and never to an IPA value.
  let masked = text;
  for (const tag of [...tags].reverse()) {
    masked = masked.slice(0, tag.index) + ' '.repeat(tag[0].length) + masked.slice(tag.index + tag[0].length);
    const word = tag[1];
    if (FOREIGN.test(word)) {
      const prefix = text.slice(0, tag.index).match(/[\p{Letter}\p{Mark}]+$/u)?.[0] || '';
      const suffix = text.slice(tag.index + tag[0].length).match(/^[\p{Letter}\p{Mark}]+/u)?.[0] || '';
      if (prefix || suffix) add(tag.index - prefix.length, tag.index + tag[0].length + suffix.length, 'A complete foreign word is split across pronunciation markup.');
      const adjacent = tagsByStart.get(tag.index + tag[0].length);
      if (adjacent && FOREIGN.test(adjacent[1])) add(tag.index, adjacent.index + adjacent[0].length, 'A complete foreign word is split across pronunciation markup.');
    }
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
  for (const match of masked.matchAll(/\(\s*\)|\\+(?=[\p{Script=Greek}\p{Script=Hebrew}])|\[[^\]\r\n]*\]\(\/[^\r\n)\]]*(?:\)|\]|$)/gu)) {
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
    let dictionaryWord: string | undefined;
    if (/^\(\s*\)$/u.test(value)) replacement = '';
    else {
      const formatted = value.replace(/^(\[[^\[\]\r\n]+\]\(\/[^/\r\n]+\/)\]$/u, '$1)');
      const visible = formatted.replace(TAG, '$1').replace(/\\/gu, '').replace(/^\[([\p{Script=Greek}\p{Script=Hebrew}\p{Mark}()'’]+)\]$/u, '$1');
      const expanded = expandScholarEditorialWords(visible);
      if (dictionary[expanded]) dictionaryWord = expanded;
      const pronunciation = lookup(expanded, dictionary);
      if (pronunciation && !/[\s<>]/u.test(visible)) replacement = `[${visible}](${pronunciation})`;
      else if (formatted !== value && !scanPronunciationIssues(formatted).length) replacement = formatted;
    }
    return { ...region, id: String(index), text: value, dictionaryWord, context: text.slice(Math.max(0, region.start - 180), Math.min(text.length, region.end + 180)), ...(replacement !== undefined ? { replacement } : {}) };
  });
}

function visibleEnglish(text: string): string {
  // Even a malformed/unclosed IPA payload is pronunciation data, not prose.
  return text.replace(TAG, '$1').replace(/\[([^\]\r\n]+)\]\(\/[^\r\n)]*(?:\)|$)/gu, '$1').replace(/<[^>]*>/gu, '').match(/\p{Script=Latin}[\p{Script=Latin}\p{Mark}'’-]*|\p{Number}+/gu)?.join(' ') || '';
}

export type RepairValidationOptions = { sourceText?: string; allowRemaining?: boolean };

function sourceSupportedReconstruction(original: string, replacement: string, sourceText = ''): boolean {
  const label = original.replace(TAG, '$1');
  const corrupt = (FOREIGN.test(label) && /\p{Script=Latin}/u.test(label))
    || getKokoroPronunciationQualityWarnings(label, '/ɑ/').some(reason => reason.includes('bare IPA'));
  if (!corrupt || !/^[\p{Letter}\p{Mark}]+$/u.test(label)) return false;
  const tag = [...replacement.matchAll(TAG)][0];
  if (!tag || tag[0] !== replacement || !/^[\p{Script=Greek}\p{Script=Hebrew}\p{Mark}]+$/u.test(tag[1])) return false;
  return Boolean(sourceText.normalize('NFC').match(/[\p{Letter}\p{Mark}]+/gu)?.some(word => word === tag[1].normalize('NFC')));
}

export function applyPronunciationPatches(text: string, issues: PronunciationIssue[], patches: PronunciationPatch[], options: RepairValidationOptions = {}): string {
  const ids = new Set<string>();
  const byId = new Map(issues.map(issue => [issue.id, issue]));
  const edits = patches.map(patch => {
    const issue = byId.get(patch.id);
    if (!issue || ids.has(patch.id) || typeof patch.replacement !== 'string' || patch.replacement.length > 12000) throw new Error('Invalid or duplicate repair patch.');
    ids.add(patch.id);
    if (/[<>]/u.test(patch.replacement) || /\[(?:SYSTEM|LAYOUT|OMIT|CHAPTER_TITLE)/iu.test(patch.replacement)) throw new Error('Repair must not introduce voice or processing markup.');
    if (visibleEnglish(issue.text) !== visibleEnglish(patch.replacement) && !sourceSupportedReconstruction(issue.text, patch.replacement, options.sourceText)) throw new Error('Repair changed unrelated English text.');
    if (text.slice(issue.start, issue.end) !== issue.text) throw new Error('Chapter text changed after scanning.');
    return { ...issue, replacement: patch.replacement };
  }).sort((a, b) => b.start - a.start);
  let result = text;
  for (const edit of edits) result = result.slice(0, edit.start) + edit.replacement + result.slice(edit.end);
  return result;
}

export function assertPronunciationRepair(previous: string, proposed: string, options: RepairValidationOptions = {}): void {
  // Human edits must also stay within the originally flagged regions.
  const issues = scanPronunciationIssues(previous);
  const proposedTags = [...proposed.matchAll(TAG)];
  let cursor = 0;
  let proposedCursor = 0;
  for (const issue of issues) {
    const unchanged = previous.slice(cursor, issue.start);
    if (!proposed.startsWith(unchanged, proposedCursor)) throw new Error('Repair changed text outside a flagged passage.');
    proposedCursor += unchanged.length;
    cursor = issue.end;
    const next = issues[issues.indexOf(issue) + 1];
    const anchor = previous.slice(cursor, next?.start ?? previous.length);
    let end = anchor ? proposed.indexOf(anchor, proposedCursor) : proposed.length;
    // Separators such as '/' and spaces also occur inside pronunciation tags.
    // Only match unchanged chapter anchors outside complete tag payloads.
    while (end >= 0 && anchor) {
      const enclosing = proposedTags.find(tag => end > tag.index && end < tag.index + tag[0].length);
      if (!enclosing) break;
      end = proposed.indexOf(anchor, enclosing.index + enclosing[0].length);
    }
    if (end < 0) throw new Error('Repair changed surrounding chapter text.');
    const replacement = proposed.slice(proposedCursor, end);
    if ((visibleEnglish(issue.text) !== visibleEnglish(replacement) && !sourceSupportedReconstruction(issue.text, replacement, options.sourceText)) || /[<>]/u.test(replacement)) throw new Error('Repair changed English text or speaker assignments.');
    proposedCursor = end;
  }
  if (previous.slice(cursor) !== proposed.slice(proposedCursor)) throw new Error('Repair changed the end of the chapter.');
  if (options.allowRemaining) return; // Proposal creation only; approval/recording never opt in.
  if (scanPronunciationIssues(proposed).length) throw new Error('Pronunciation issues remain. Review the proposal before recording.');
  validateSmartAudioOutput(proposed, { requirePronunciationTagsForForeignScripts: FOREIGN.test(previous) });
}

export function canonicalRepairTextFile(fileName: string): string {
  return fileName.replace(/__rejected\.txt$/u, '__text.txt');
}
