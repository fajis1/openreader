import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';

import {
  replaceGlobalPronunciationChoices,
  recordLearnedGlobalPronunciation,
  removeGlobalPronunciationChoice,
  setGlobalPronunciationDefault,
  type GlobalPronunciationLibrary,
} from '../../src/lib/server/tts/global-pronunciation-library';

describe('global pronunciation administration', () => {
  const library: GlobalPronunciationLibrary = {
    'στοιχεῖα': [
      { phonetic: 'stɔɪxɛːa', usageCount: 2 },
      { phonetic: '/stixia/', usageCount: 1 },
    ],
  };

  test('moves an existing choice to the first/default position and repairs wrappers', () => {
    expect(setGlobalPronunciationDefault(library, 'στοιχεῖα', 'stixia')).toEqual([
      { phonetic: '/stixia/', usageCount: 1 },
      { phonetic: 'stɔɪxɛːa', usageCount: 2 },
    ]);
  });

  test('replaces all choices and puts the selected AI suggestion first', () => {
    expect(replaceGlobalPronunciationChoices(
      'στοιχεῖα',
      ['/stɔɪxeɪɑ/', '/stixia/', '/stɔɪxeːa/'],
      1,
    )?.map(({ phonetic }) => phonetic)).toEqual([
      '/stixia/',
      '/stɔɪxeɪɑ/',
      '/stɔɪxeːa/',
    ]);
  });

  test('rejects malformed or suspect replacement sets', () => {
    expect(replaceGlobalPronunciationChoices('στοιχεῖα', [''], 0)).toBeNull();
    expect(replaceGlobalPronunciationChoices('στοιχεῖα', ['/styyia/'], 0)).toBeNull();
  });

  test('keeps the global default first while learning and evicting alternatives', () => {
    const full = [
      { phonetic: '/default/', usageCount: 0 },
      { phonetic: '/one/', usageCount: 5 },
      { phonetic: '/two/', usageCount: 0 },
      { phonetic: '/three/', usageCount: 3 },
      { phonetic: '/four/', usageCount: 4 },
    ];
    expect(recordLearnedGlobalPronunciation(full, '/new/')).toEqual([
      { phonetic: '/default/', usageCount: 0 },
      { phonetic: '/one/', usageCount: 5 },
      expect.objectContaining({ phonetic: '/new/', usageCount: 1 }),
      { phonetic: '/three/', usageCount: 3 },
      { phonetic: '/four/', usageCount: 4 },
    ]);
    expect(recordLearnedGlobalPronunciation(full, '/one/')[0].phonetic).toBe('/default/');
    expect(recordLearnedGlobalPronunciation(full, '/one/')[1].usageCount).toBe(6);
  });

  test('removes one global choice and promotes the next choice when needed', () => {
    expect(removeGlobalPronunciationChoice(library, 'στοιχεῖα', 'stɔɪxɛːa')).toEqual({
      removed: true,
      choices: [{ phonetic: '/stixia/', usageCount: 1 }],
    });
    expect(removeGlobalPronunciationChoice(library, 'στοιχεῖα', '/missing/').removed).toBe(false);
    expect(removeGlobalPronunciationChoice(
      { λόγος: [{ phonetic: '/loˈgos/' }] },
      'λόγος',
      '/loˈgos/',
    ).removed).toBe(true);
  });

  test('exposes admin-only default and guided AI replacement controls', () => {
    const component = fs.readFileSync(
      path.join(process.cwd(), 'src/components/SmartAudioSettings.tsx'),
      'utf8',
    );
    const route = fs.readFileSync(
      path.join(process.cwd(), 'src/app/api/tts/global-pronunciations/route.ts'),
      'utf8',
    );
    expect(component).toContain('Global default');
    expect(component).toContain('Make Global Default');
    expect(component).toContain('Ask AI for 5 Replacement Choices');
    expect(component).toContain('Apply Reviewed Choices Globally');
    expect(component).toContain('Delete Word from Global Library');
    expect(component).toContain('Remove Choice');
    expect(component).toContain("action: 'delete-word'");
    expect(component).toContain("action: 'delete-choice'");
    expect(component).toContain("trimmed.startsWith('/') && trimmed.endsWith('/')");
    expect(component).toContain('{isAdmin &&');
    expect(route).toContain("body.action === 'set-default'");
    expect(route).toContain("body.action === 'replace-choices'");
    expect(route).toContain("body.action === 'delete-choice'");
    expect(route).toContain("body.action === 'delete-word'");
    expect(route).toContain('delete latestLibrary[word]');
    expect(route).toContain('requireAdminContext(req)');
    expect(route).toContain('pg_advisory_xact_lock');
    expect(route).toContain('const latestLibrary = normalizeGlobalPronunciationLibrary');
    expect(route).toContain('mutateGlobalPronunciationLibrary');
    expect(route).toContain('.limit(1)\n        .all();');
    expect(route).toContain('}).run();');
    expect(route).not.toContain('Object.keys(parsed).length === 0');
  });

  test('keeps new-word-only generation as the scan default', () => {
    const component = fs.readFileSync(
      path.join(process.cwd(), 'src/components/doclist/ScanForeignWordsModal.tsx'),
      'utf8',
    );
    const route = fs.readFileSync(
      path.join(process.cwd(), 'src/app/api/documents/scan-foreign-words/route.ts'),
      'utf8',
    );
    expect(component).toContain('useState(true)');
    expect(component).toContain('skip existing global/profile pronunciations');
    expect(route).toContain('body.generateOnlyForNewWords !== false');
    expect(route).toContain('compatibleGlobalChoices.length === 0');
    expect(route).toContain('!compatibleOverrides[w.word]');
  });
});
