const KOKORO_TAG_GLOBAL = /\[[^\]\r\n]+\]\(\/[^/\r\n]+\/\)/gu;
const UNTAGGED_FOREIGN_WORD = /([\p{Script=Greek}\p{Script=Hebrew}][\p{Script=Greek}\p{Script=Hebrew}\p{Mark}'’ʼ᾽]*)([\t ]?)/gu;
const FOREIGN_SCRIPT = /[\p{Script=Greek}\p{Script=Hebrew}]/u;

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
): string {
  return text.replace(
    UNTAGGED_FOREIGN_WORD,
    (_match, rawTerm: string, followingSpace: string) => {
      const pronunciation = findPronunciation(rawTerm, lookup);
      if (pronunciation) {
        taggedTerms.push(rawTerm);
        return `[${rawTerm}](${pronunciation})${followingSpace}`;
      }
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
): ScholarBatchRefineSafetyResult {
  const lookup = pronunciationLookup(pronunciations);
  const taggedTerms: string[] = [];
  const removedTerms: string[] = [];
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
    );
    result += match[0];
    lastIndex = index + match[0].length;
  }
  result += processUntaggedText(
    text.slice(lastIndex),
    lookup,
    taggedTerms,
    removedTerms,
  );

  return { text: result, taggedTerms, removedTerms };
}

export function hasUntaggedScholarForeignScript(text: string): boolean {
  return FOREIGN_SCRIPT.test(text.replace(KOKORO_TAG_GLOBAL, ''));
}
