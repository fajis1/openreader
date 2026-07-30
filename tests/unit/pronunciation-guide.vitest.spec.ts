import { describe, expect, test } from 'vitest';
import {
  createPronunciationGuide,
  mergePronunciationEntries,
  parsePronunciationGuide,
} from '../../src/lib/shared/pronunciation-guide';

const current = [
  { word: 'logos', phonetic: '/old/' },
  { word: 'agape', phonetic: '/love/' },
];
const incoming = [
  { word: 'logos', phonetic: '/new/' },
  { word: 'shalom', phonetic: '/peace/' },
];

describe('pronunciation guides', () => {
  test('round-trips the portable JSON format without profile secrets', () => {
    const guide = createPronunciationGuide('Shared guide', incoming, '2026-07-30T00:00:00.000Z');
    expect(parsePronunciationGuide(JSON.stringify(guide))).toEqual(guide);
    expect(JSON.stringify(guide)).not.toContain('apiKey');
  });

  test('imports legacy two-column CSV guides', () => {
    expect(parsePronunciationGuide('logos,/loʊɡɒs/\nshalom,/ʃɑːloʊm/').entries).toEqual([
      { word: 'logos', phonetic: '/loʊɡɒs/' },
      { word: 'shalom', phonetic: '/ʃɑːloʊm/' },
    ]);
  });

  test('adds only words that do not already exist', () => {
    expect(mergePronunciationEntries(current, incoming, 'add-new')).toEqual([
      ...current,
      incoming[1],
    ]);
  });

  test('overwrites matches while preserving other existing words', () => {
    expect(mergePronunciationEntries(current, incoming, 'overwrite-matches')).toEqual([
      { word: 'logos', phonetic: '/new/' },
      current[1],
      incoming[1],
    ]);
  });

  test('can replace the entire existing guide', () => {
    expect(mergePronunciationEntries(current, incoming, 'replace-all')).toEqual(incoming);
  });
});
