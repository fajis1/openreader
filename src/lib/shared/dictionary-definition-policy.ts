const UNUSABLE_DEFINITION_PATTERNS = [
  /^fragment(?:ary)?\s+(?:or|\/)\s+(?:an?\s+)?inflected\s+form[.!]?$/iu,
  /^(?:an?\s+)?(?:ocr|word|text|unidentified)\s+fragment[.!]?$/iu,
  /^(?:an?\s+)?inflected\s+form(?:\s+or\s+(?:an?\s+)?(?:ocr\s+)?fragment(?:ary)?)?[.!]?$/iu,
  /\S+\s+fragment[.!]?$/iu,
];

const FUNCTION_WORD_ONLY_GLOSSES = new Set([
  'a', 'an', 'the',
  'and', 'but', 'nor', 'or', 'so', 'yet',
  'as', 'at', 'by', 'for', 'from', 'in', 'into', 'like', 'of', 'off', 'on', 'onto',
  'than', 'through', 'to', 'up', 'with', 'without',
  'i', 'me', 'my', 'mine', 'myself',
  'you', 'your', 'yours', 'yourself', 'yourselves',
  'he', 'him', 'his', 'himself',
  'she', 'her', 'hers', 'herself',
  'it', 'its', 'itself',
  'we', 'us', 'our', 'ours', 'ourselves',
  'they', 'them', 'their', 'theirs', 'themselves',
  'this', 'that', 'these', 'those', 'which', 'who', 'whom', 'whose',
]);

function splitAlternativeGlosses(value: string): string[] {
  return value
    .split(/\s*(?:[,;|/])\s*|\s+(?:and\/or|and|or)\s+/iu)
    .map((part) => part.trim())
    .filter(Boolean);
}

function isFunctionWordOnlyGloss(value: string): boolean {
  const words = value
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .match(/[\p{L}\p{N}]+/gu) || [];
  return words.length > 0 && words.every((word) => FUNCTION_WORD_ONLY_GLOSSES.has(word));
}

export function getDictionaryDefinitionQualityWarnings(value: unknown): string[] {
  if (typeof value !== 'string' || !value.trim()) return [];
  const normalized = value.trim().replace(/\s+/g, ' ');
  const warnings: string[] = [];
  if (UNUSABLE_DEFINITION_PATTERNS.some((pattern) => pattern.test(normalized))) {
    warnings.push('Placeholder describes the token form instead of giving a contextual meaning.');
  }
  const alternatives = splitAlternativeGlosses(normalized);
  if (alternatives.length > 1) {
    warnings.push('Contains multiple meanings; only the first contextual gloss will be kept.');
  }
  if (isFunctionWordOnlyGloss(alternatives[0] || normalized)) {
    warnings.push('Gloss contains only common connecting or function words and should not be narrated.');
  }
  return warnings;
}

export function normalizeDictionaryDefinition(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const normalized = value.trim().replace(/\s+/g, ' ');
  if (UNUSABLE_DEFINITION_PATTERNS.some((pattern) => pattern.test(normalized))) return null;
  const firstGloss = splitAlternativeGlosses(normalized)[0] || normalized;
  if (isFunctionWordOnlyGloss(firstGloss)) return null;
  return firstGloss.split(/\s+/).slice(0, 4).join(' ');
}

export function shouldOmitDictionaryDefinition(value: unknown): boolean {
  return typeof value === 'string'
    && Boolean(value.trim())
    && normalizeDictionaryDefinition(value) === null;
}
