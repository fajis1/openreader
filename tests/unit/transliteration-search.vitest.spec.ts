import { describe, expect, test } from 'vitest';
import { matchesTransliteratedTerm } from '@/lib/shared/transliteration-search';

describe('transliteration-aware pronunciation search', () => {
  test('fuzzy matches a Latin spelling to a polytonic Greek term', () => {
    expect(matchesTransliteratedTerm('ἐκκλησία', 'ekklasia')).toBe(true);
    expect(matchesTransliteratedTerm('Θεσμοφόρος', 'thesmophoros')).toBe(true);
  });

  test('retains literal Greek and rejects unrelated Latin searches', () => {
    expect(matchesTransliteratedTerm('ἐκκλησία', 'κλησ')).toBe(true);
    expect(matchesTransliteratedTerm('ἐκκλησία', 'theos')).toBe(false);
  });
});
