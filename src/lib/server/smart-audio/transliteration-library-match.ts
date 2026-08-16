import { normalizeDictionaryDefinition } from '@/lib/shared/dictionary-definition-policy';

type ScriptKind = 'greek' | 'hebrew' | 'latin' | 'other';

export type TransliterationLibraryRecord = {
  pronunciation?: string | null;
  definition?: string | null;
};

export type TransliterationLibraryMatch = {
  sourceTerm: string;
  pronunciation: string | null;
  definition: string | null;
};

const GREEK_LETTERS: Record<string, string> = {
  α: 'a', β: 'b', γ: 'g', δ: 'd', ε: 'e', ζ: 'z', η: 'e', θ: 'th',
  ι: 'i', κ: 'k', λ: 'l', μ: 'm', ν: 'n', ξ: 'x', ο: 'o', π: 'p',
  ρ: 'r', σ: 's', ς: 's', τ: 't', υ: 'y', φ: 'ph', χ: 'ch', ψ: 'ps', ω: 'o',
};

const HEBREW_LETTERS: Record<string, string> = {
  א: '', ב: 'b', ג: 'g', ד: 'd', ה: 'h', ו: 'w', ז: 'z', ח: 'ch', ט: 't',
  י: 'y', כ: 'k', ך: 'k', ל: 'l', מ: 'm', ם: 'm', נ: 'n', ן: 'n', ס: 's',
  ע: '', פ: 'p', ף: 'p', צ: 'ts', ץ: 'ts', ק: 'q', ר: 'r', ש: 'sh', ת: 't',
};

function scriptKind(value: string): ScriptKind {
  if (/\p{Script=Greek}/u.test(value)) return 'greek';
  if (/\p{Script=Hebrew}/u.test(value)) return 'hebrew';
  if (/\p{Script=Latin}/u.test(value)) return 'latin';
  return 'other';
}

function latinLetters(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/\p{Mark}/gu, '')
    .toLocaleLowerCase('en-US')
    .replace(/[^a-z]/g, '');
}

function transliterate(value: string, script: ScriptKind): string {
  if (script === 'latin') return latinLetters(value);
  const map = script === 'greek' ? GREEK_LETTERS : HEBREW_LETTERS;
  return [...value.normalize('NFD').toLocaleLowerCase('en-US')]
    .map((character) => map[character] ?? '')
    .join('');
}

function foldedVariants(value: string, script: ScriptKind): Set<string> {
  const exact = transliterate(value, script);
  if (!exact) return new Set();
  const variants = new Set([exact]);
  variants.add(exact.replaceAll('ph', 'f').replaceAll('ch', 'kh'));
  variants.add(exact.replaceAll('y', 'u'));
  variants.add(exact.replaceAll('y', 'i'));
  if (script === 'greek' && value.normalize('NFD').includes('\u0314')) {
    variants.add(`h${exact.replace(/^y/, 'u')}`);
  }
  return new Set([...variants].filter((variant) => variant.length >= 4));
}

function matchKeys(value: string, script: ScriptKind): Set<string> {
  const variants = foldedVariants(value, script);
  const keys = new Set([...variants].map((variant) => `exact:${variant}`));
  for (const variant of variants) {
    const skeleton = variant
      .replaceAll('sh', 'Š')
      .replaceAll('ch', 'Č')
      .replaceAll('th', 'Ť')
      .replaceAll('ph', 'F')
      .replaceAll('ts', 'C')
      .replace(/[aeiouy]/g, '')
      // Hebrew matres lectionis commonly represent vowels in unpointed text.
      .replace(script === 'hebrew' ? /w/g : /$^/g, '')
      .replaceAll('Š', 'sh')
      .replaceAll('Č', 'ch')
      .replaceAll('Ť', 'th')
      .replaceAll('F', 'ph')
      .replaceAll('C', 'ts');
    if (skeleton.length >= 4) keys.add(`skeleton:${skeleton}`);
  }
  return keys;
}

/**
 * Finds one unambiguous Greek/Hebrew <-> Latin dictionary alias. It never
 * matches two same-script spellings and refuses conflicting source records.
 */
export function findTransliterationLibraryMatch(
  term: string,
  records: Readonly<Record<string, TransliterationLibraryRecord>>,
): TransliterationLibraryMatch | null {
  const targetScript = scriptKind(term);
  if (targetScript === 'other') return null;
  const targetKeys = matchKeys(term, targetScript);
  if (targetKeys.size === 0) return null;

  const candidates = Object.entries(records).filter(([sourceTerm]) => {
    const sourceScript = scriptKind(sourceTerm);
    if (sourceScript === targetScript || sourceScript === 'other') return false;
    if (targetScript !== 'latin' && sourceScript !== 'latin') return false;
    return [...matchKeys(sourceTerm, sourceScript)].some((key) => targetKeys.has(key));
  });
  if (candidates.length === 0) return null;

  const resolved = candidates.map(([sourceTerm, record]) => ({
    sourceTerm,
    pronunciation: typeof record.pronunciation === 'string' && record.pronunciation.trim()
      ? record.pronunciation.trim()
      : null,
    definition: normalizeDictionaryDefinition(record.definition),
  }));
  const valueSignatures = new Set(
    resolved.map((candidate) => JSON.stringify([candidate.pronunciation, candidate.definition])),
  );
  if (valueSignatures.size !== 1) return null;
  const match = resolved[0];
  return match && (match.pronunciation || match.definition) ? match : null;
}
