import { describe, expect, test } from 'vitest';
import { findTransliterationLibraryMatch } from '@/lib/server/smart-audio/transliteration-library-match';

describe('bidirectional transliteration library matching', () => {
  test('reuses a Latin pronunciation and definition for a Greek-script term', () => {
    expect(findTransliterationLibraryMatch('λόγος', {
      logos: { pronunciation: '/ˈloʊɡɒs/', definition: 'word' },
    })).toEqual({
      sourceTerm: 'logos',
      pronunciation: '/ˈloʊɡɒs/',
      definition: 'word',
    });
  });

  test('reuses a Greek definition for a Latin transliteration', () => {
    expect(findTransliterationLibraryMatch('logos', {
      'λόγος': { pronunciation: '/ˈloʊɡɒs/', definition: 'word' },
    })?.sourceTerm).toBe('λόγος');
  });

  test('recognizes a Greek rough-breathing transliteration', () => {
    expect(findTransliterationLibraryMatch('υἱοθεσία', {
      huiothesia: { pronunciation: '/huioʊθɛsiɑ/', definition: 'adoption' },
    })?.definition).toBe('adoption');
  });

  test('matches Hebrew and Latin transliteration in both directions', () => {
    const records = { shalom: { pronunciation: '/ʃɑˈloʊm/', definition: 'peace' } };
    expect(findTransliterationLibraryMatch('שלום', records)?.definition).toBe('peace');
    expect(findTransliterationLibraryMatch('shalom', {
      'שלום': records.shalom,
    })?.pronunciation).toBe('/ʃɑˈloʊm/');
  });

  test('matches an academic Latin spelling to unpointed Hebrew', () => {
    expect(findTransliterationLibraryMatch('qadosh', {
      'קדוש': { pronunciation: '/kɑˈdoʊʃ/', definition: 'holy' },
    })?.definition).toBe('holy');
  });

  test('rejects ambiguous aliases with conflicting values', () => {
    expect(findTransliterationLibraryMatch('logos', {
      'λόγος': { pronunciation: '/one/', definition: 'word' },
      'λογος': { pronunciation: '/two/', definition: 'speech' },
    })).toBeNull();
  });

  test('does not match unrelated same-script terms or short aliases', () => {
    expect(findTransliterationLibraryMatch('logos', {
      logas: { pronunciation: '/wrong/' },
    })).toBeNull();
    expect(findTransliterationLibraryMatch('יה', {
      yah: { pronunciation: '/jɑ/' },
    })).toBeNull();
  });
});
