const UNUSABLE_DEFINITION_PATTERNS = [
  /^fragment(?:ary)?\s+(?:or|\/)\s+(?:an?\s+)?inflected\s+form[.!]?$/iu,
  /^(?:an?\s+)?(?:ocr|word|text|unidentified)\s+fragment[.!]?$/iu,
  /^(?:an?\s+)?inflected\s+form(?:\s+or\s+(?:an?\s+)?(?:ocr\s+)?fragment(?:ary)?)?[.!]?$/iu,
];

export function getDictionaryDefinitionQualityWarnings(value: unknown): string[] {
  if (typeof value !== 'string' || !value.trim()) return [];
  const normalized = value.trim().replace(/\s+/g, ' ');
  return UNUSABLE_DEFINITION_PATTERNS.some((pattern) => pattern.test(normalized))
    ? ['Placeholder describes the token form instead of giving a contextual meaning.']
    : [];
}

export function normalizeDictionaryDefinition(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const normalized = value.trim().replace(/\s+/g, ' ');
  if (getDictionaryDefinitionQualityWarnings(normalized).length > 0) return null;
  return normalized.split(/\s+/).slice(0, 4).join(' ');
}

export function shouldOmitDictionaryDefinition(value: unknown): boolean {
  return getDictionaryDefinitionQualityWarnings(value).length > 0;
}
