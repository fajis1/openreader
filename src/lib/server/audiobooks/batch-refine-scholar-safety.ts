import { expandScholarEditorialWords, hasSplitScholarEditorialWord } from '@/lib/shared/scholar-editorial-words';

const KOKORO_TAG_GLOBAL = /\[[^\]\r\n]+\]\(\/[^/\r\n]+\/\)/gu;
const UNTAGGED_FOREIGN_WORD = /([\p{Script=Greek}\p{Mark}]+(?:\([\p{Script=Greek}\p{Mark}]+\)[\p{Script=Greek}\p{Mark}]*)+|[\p{Script=Hebrew}\p{Mark}]+(?:\([\p{Script=Hebrew}\p{Mark}]+\)[\p{Script=Hebrew}\p{Mark}]*)+|[\p{Script=Greek}\p{Script=Hebrew}][\p{Script=Greek}\p{Script=Hebrew}\p{Mark}'’ʼ᾽]*)([\t ]?)/gu;
const FOREIGN_SCRIPT = /[\p{Script=Greek}\p{Script=Hebrew}]/u;
const LETTER = /\p{Letter}/u;

type PronunciationLookup = {
  exact: Map<string, string | null>;
  folded: Map<string, string | null>;
  accentFolded: Map<string, string | null>;
};

export type ScholarBatchRefineSafetyResult = {
  text: string;
  taggedTerms: string[];
  removedTerms: string[];
};

function accentFolded(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Mark}/gu, '')
    .toLocaleLowerCase();
}

function setUnique(
  target: Map<string, string | null>,
  key: string,
  pronunciation: string,
): void {
  const current = target.get(key);
  if (current === undefined) target.set(key, pronunciation);
  else if (current !== pronunciation) target.set(key, null);
}

function pronunciationLookup(pronunciations: Record<string, string>): PronunciationLookup {
  const lookup: PronunciationLookup = {
    exact: new Map(),
    folded: new Map(),
    accentFolded: new Map(),
  };
  for (const [rawTerm, rawPronunciation] of Object.entries(pronunciations)) {
    const term = rawTerm.trim().normalize('NFC');
    const pronunciation = rawPronunciation.trim();
    if (!term || /\s/u.test(term) || !/^\/[^/\r\n]+\/$/u.test(pronunciation)) continue;
    setUnique(lookup.exact, term, pronunciation);
    setUnique(lookup.folded, term.toLocaleLowerCase(), pronunciation);
    setUnique(lookup.accentFolded, accentFolded(term), pronunciation);
  }
  return lookup;
}

function findPronunciation(term: string, lookup: PronunciationLookup): string | null {
  const normalized = term.normalize('NFC');
  return lookup.exact.get(normalized)
    ?? lookup.folded.get(normalized.toLocaleLowerCase())
    ?? lookup.accentFolded.get(accentFolded(normalized))
    ?? null;
}

function processUntaggedText(
  text: string,
  lookup: PronunciationLookup,
  taggedTerms: string[],
  removedTerms: string[],
  preserveUnresolvedEditorialWords: boolean,
): string {
  return text.replace(
    UNTAGGED_FOREIGN_WORD,
    (_match, rawTerm: string, followingSpace: string) => {
      const expanded = expandScholarEditorialWords(rawTerm);
      const pronunciation = findPronunciation(expanded, lookup);
      if (pronunciation) {
        taggedTerms.push(rawTerm);
        return `[${rawTerm}](${pronunciation})${followingSpace}`;
      }
      if (preserveUnresolvedEditorialWords && expanded !== rawTerm) return rawTerm + followingSpace;
      removedTerms.push(rawTerm);
      return '';
    },
  );
}

/**
 * Enforces the Scholar audiobook invariant before Gemini proposes deletions:
 * known foreign words receive reviewed Kokoro markup, while unresolved bare
 * Greek or Hebrew is removed under the Scholar safety policy. Existing Kokoro
 * tags are immutable and are never revalidated or reformatted here.
 */
export function prepareScholarBatchRefineText(
  text: string,
  pronunciations: Record<string, string>,
  options: { preserveUnresolvedEditorialWords?: boolean } = {},
): ScholarBatchRefineSafetyResult {
  const lookup = pronunciationLookup(pronunciations);
  const taggedTerms: string[] = [];
  const removedTerms: string[] = [];
  // Discard partial IPA only when the visible form proves an internal
  // editorial continuation. The expanded word must get a complete lookup.
  text = text.replace(/\[([^\]\r\n]+)\]\(\/[^/\r\n]+\/\)(\([\p{Script=Greek}\p{Script=Hebrew}\p{Mark}]+\)[\p{Script=Greek}\p{Script=Hebrew}\p{Mark}]*)/gu,
    (match, word: string, suffix: string) => {
      const printed = word + suffix;
      const expanded = expandScholarEditorialWords(printed);
      if (expanded === printed) return match;
      const pronunciation = findPronunciation(expanded, lookup);
      if (pronunciation) {
        taggedTerms.push(expanded);
        return `[${printed}](${pronunciation})`;
      }
      // Preserve the complete unresolved word for review instead of silently
      // deleting its ending and retaining a confidently tagged fragment.
      return printed;
    });
  // Reject separately tagged editorial fragments; their IPA cannot be safely
  // combined. Keep the chapter intact for a context-aware cleanup/review pass.
  if (hasSplitScholarEditorialWord(text)) {
    throw new Error('Split Scholar editorial word requires complete-word pronunciation repair.');
  }
  let result = '';
  let lastIndex = 0;

  KOKORO_TAG_GLOBAL.lastIndex = 0;
  for (const match of text.matchAll(KOKORO_TAG_GLOBAL)) {
    const index = match.index;
    result += processUntaggedText(
      text.slice(lastIndex, index),
      lookup,
      taggedTerms,
      removedTerms,
      options.preserveUnresolvedEditorialWords === true,
    );
    result += match[0];
    lastIndex = index + match[0].length;
  }
  result += processUntaggedText(
    text.slice(lastIndex),
    lookup,
    taggedTerms,
    removedTerms,
    options.preserveUnresolvedEditorialWords === true,
  );

  return { text: result, taggedTerms, removedTerms };
}

export function hasUntaggedScholarForeignScript(text: string): boolean {
  if (hasSplitScholarEditorialWord(text)) return true;
  const untaggedText = text.replace(KOKORO_TAG_GLOBAL, '');
  // Greek-block punctuation and editorial breathing marks are not words. Only
  // actual Greek/Hebrew letters outside markup should block recording.
  return Array.from(untaggedText).some(character => FOREIGN_SCRIPT.test(character) && LETTER.test(character));
}
