import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';

import {
  applyDictionaryReleaseToGlobal,
  applyDictionaryReleaseToProfile,
  buildDictionaryReleaseUpdates,
  fingerprintDefinition,
  fingerprintPronunciationChoices,
  parseDictionaryReleaseTombstones,
} from '../../src/lib/server/tts/dictionary-release';
import type { SmartAudioProfile } from '../../src/types/client';
import { previewGlobalDefinitionImport } from '../../src/lib/server/smart-audio/global-definition-library';
import { previewGlobalPronunciationImport } from '../../src/lib/server/tts/global-pronunciation-library';

const sharedChoices = [
  { phonetic: '/shared/', usageCount: 4 },
  { phonetic: '/alternative/', usageCount: 1 },
];
const retiredChoices = [{ phonetic: '/B, A, D/' }];
const tombstones = {
  version: 1,
  generatedAt: '2026-08-09T00:00:00.000Z',
  entries: {
    malformed: {
      reasons: ['mixed-script-key'],
      pronunciations: {
        fingerprint: fingerprintPronunciationChoices(retiredChoices),
        choices: ['/B, A, D/'],
      },
      definition: {
        fingerprint: fingerprintDefinition('OCR fragment'),
        value: 'OCR fragment',
      },
    },
  },
};

const profile = (pronunciations: Record<string, string>): SmartAudioProfile => ({
  id: 'profile',
  name: 'Profile',
  aiModel: 'model',
  customTtsPrompt: '',
  abbreviations: {},
  pronunciations,
  books: {},
});

describe('bundled dictionary releases', () => {
  test('ships an entirely validated, idempotently cleaned Git dictionary release', () => {
    const pronunciations = JSON.parse(fs.readFileSync(
      path.join(process.cwd(), 'src/lib/server/default_global_pronunciations.json'),
      'utf8',
    ));
    const definitions = JSON.parse(fs.readFileSync(
      path.join(process.cwd(), 'src/lib/server/default_global_definitions.json'),
      'utf8',
    ));
    const rawTombstones = JSON.parse(fs.readFileSync(
      path.join(process.cwd(), 'src/lib/server/default_global_pronunciation_tombstones.json'),
      'utf8',
    ));
    const pronunciationPreview = previewGlobalPronunciationImport(pronunciations);
    const definitionPreview = previewGlobalDefinitionImport(definitions);
    const parsedTombstones = parseDictionaryReleaseTombstones(rawTombstones);
    expect(pronunciationPreview.issues).toEqual([]);
    expect(pronunciationPreview.validWords).toBe(2_584);
    expect(pronunciationPreview.validChoices).toBe(9_782);
    expect(definitionPreview.issues).toEqual([]);
    expect(definitionPreview.validDefinitions).toBe(1_978);
    expect(Object.keys(parsedTombstones.entries)).toHaveLength(957);
    expect(parsedTombstones.entries['πáντων']?.reasons).toContain('mixed-script-key');
    expect(parsedTombstones.entries['πνεν͂']?.pronunciations?.choices).toContain('/pnuːm/');
    expect(parsedTombstones.entries['υἱοθεσ']?.pronunciations?.choices).toContain('/θɛs/');
    expect(parsedTombstones.entries['םלוע']?.reasons).toContain('known-reversed-or-damaged-hebrew');
    expect(pronunciations.κτλ[0].phonetic).toBe('/K, T, L/');
    expect(pronunciations['πνεῦμα'][0].phonetic).toBe('/njumɑ/');
    expect(pronunciations['υἱοθεσία'][0].phonetic).toBe('/hwioʊθɛsiɑ/');

    const greekCaseGroups = new Map<string, string[]>();
    for (const word of Object.keys(pronunciations)) {
      if (!/\p{Script=Greek}/u.test(word)) continue;
      const folded = word.normalize('NFC').toLocaleLowerCase();
      greekCaseGroups.set(folded, [...(greekCaseGroups.get(folded) || []), word]);
    }
    const conflictingDefaults = [...greekCaseGroups.entries()]
      .filter(([, words]) => words.length > 1)
      .filter(([, words]) => new Set(words.map((word) => pronunciations[word][0].phonetic)).size > 1)
      .map(([folded]) => folded)
      .sort();
    expect(conflictingDefaults).toEqual(['δία', 'δια']);
    expect(pronunciations['θεοῦ']).toEqual(pronunciations['Θεοῦ']);
    expect(pronunciations['ποιεῖσθαι']).toEqual(pronunciations['Ποιεῖσθαι']);
    expect(pronunciations['διαθήκαι']).toEqual(pronunciations['Διαθήκαι']);
  });

  test('validates tombstone fingerprints before accepting deletion instructions', () => {
    expect(parseDictionaryReleaseTombstones(tombstones).entries.malformed).toBeDefined();
    expect(parseDictionaryReleaseTombstones({
      ...tombstones,
      entries: {
        malformed: {
          ...tombstones.entries.malformed,
          pronunciations: {
            ...tombstones.entries.malformed.pronunciations,
            fingerprint: 'sha256:tampered',
          },
        },
      },
    }).entries.malformed.pronunciations).toBeUndefined();
  });

  test('compares complete pronunciation choice sets rather than only the default', () => {
    const updates = buildDictionaryReleaseUpdates({
      gitPronunciations: { shared: sharedChoices },
      gitDefinitions: {},
      tombstones,
      globalPronunciations: { shared: [sharedChoices[0]] },
      globalDefinitions: {},
      isAdmin: true,
    });
    expect(updates).toContainEqual(expect.objectContaining({
      word: 'shared',
      type: 'pronunciation',
      status: 'conflict',
      safeToApply: false,
      gitChoices: sharedChoices,
    }));
  });

  test('preselects only unchanged retired values and protects local modifications', () => {
    const unchanged = buildDictionaryReleaseUpdates({
      gitPronunciations: {},
      gitDefinitions: {},
      tombstones,
      globalPronunciations: { malformed: retiredChoices },
      globalDefinitions: { malformed: 'OCR fragment' },
      isAdmin: true,
    });
    expect(unchanged).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'pronunciation-removal', status: 'remove', safeToApply: true }),
      expect.objectContaining({ type: 'definition-removal', status: 'remove', safeToApply: true }),
    ]));

    const modified = buildDictionaryReleaseUpdates({
      gitPronunciations: {},
      gitDefinitions: {},
      tombstones,
      globalPronunciations: { malformed: [{ phonetic: '/locally-fixed/' }] },
      globalDefinitions: { malformed: 'Locally fixed meaning' },
      isAdmin: true,
    });
    expect(modified).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'pronunciation-removal', status: 'deletion-conflict', safeToApply: false }),
      expect.objectContaining({ type: 'definition-removal', status: 'deletion-conflict', safeToApply: false }),
    ]));
  });

  test('applies full shared choices and selected tombstones without touching local-only words', () => {
    const applied = applyDictionaryReleaseToGlobal({
      currentPronunciations: {
        shared: [{ phonetic: '/local/' }],
        malformed: retiredChoices,
        localOnly: [{ phonetic: '/keep/' }],
      },
      currentDefinitions: {
        malformed: 'OCR fragment',
        localOnly: 'keep this',
      },
      gitPronunciations: { shared: sharedChoices },
      gitDefinitions: { shared: 'shared meaning' },
      tombstones,
      selectedPronunciationWords: new Set(['shared']),
      selectedDefinitionWords: new Set(['shared']),
      selectedPronunciationRemovals: new Set(['malformed']),
      selectedDefinitionRemovals: new Set(['malformed']),
    });
    expect(applied.pronunciations.shared).toEqual(sharedChoices);
    expect(applied.pronunciations.localOnly).toEqual([{ phonetic: '/keep/' }]);
    expect(applied.pronunciations.malformed).toBeUndefined();
    expect(applied.definitions).toEqual({ localOnly: 'keep this', shared: 'shared meaning' });
  });

  test('lets a user adopt the shared default or remove an imported retired override', () => {
    const applied = applyDictionaryReleaseToProfile({
      profile: profile({ malformed: '/B, A, D/', localOnly: '/keep/' }),
      gitPronunciations: { shared: sharedChoices },
      tombstones,
      selectedPronunciationWords: new Set(['shared']),
      selectedPronunciationRemovals: new Set(['malformed']),
      resolvedDictionaryHash: 'release-hash',
    });
    expect(applied.pronunciations).toEqual({ localOnly: '/keep/', shared: '/shared/' });
    expect(applied.resolvedDictionaryHash).toBe('release-hash');
  });

  test('the API and modal preserve safe defaults, conflicts, and complete-choice semantics', () => {
    const route = fs.readFileSync(
      path.join(process.cwd(), 'src/app/api/tts/dictionary-updates/route.ts'),
      'utf8',
    );
    const modal = fs.readFileSync(
      path.join(process.cwd(), 'src/components/DictionaryUpdateModal.tsx'),
      'utf8',
    );
    const onboarding = fs.readFileSync(
      path.join(process.cwd(), 'src/contexts/OnboardingFlowContext.tsx'),
      'utf8',
    );
    const appLayout = fs.readFileSync(
      path.join(process.cwd(), 'src/app/(app)/layout.tsx'),
      'utf8',
    );
    const dockerfile = fs.readFileSync(path.join(process.cwd(), 'Dockerfile'), 'utf8');
    const nextConfig = fs.readFileSync(path.join(process.cwd(), 'next.config.ts'), 'utf8');
    const syncScript = fs.readFileSync(
      path.join(process.cwd(), 'scripts/sync-dict-to-git.mjs'),
      'utf8',
    );
    const entrypoint = fs.readFileSync(
      path.join(process.cwd(), 'scripts/openreader-entrypoint.mjs'),
      'utf8',
    );
    expect(route).toContain('TOMBSTONE_FILE');
    expect(route).toContain('selectedPronunciationRemovals');
    expect(route).toContain('body.hash !== release.hash');
    expect(route).toContain("pg_advisory_xact_lock");
    expect(route).toContain('.limit(1)\n      .all();');
    expect(route).toContain("upsertSetting(tx, 'global_pronunciations', applied.pronunciations).run()");
    expect(modal).toContain('filter((update) => update.safeToApply)');
    expect(modal).toContain('selectedPronunciationWords');
    expect(modal).toContain('selectedPronunciationRemovals');
    expect(modal).toContain('Locally modified; kept by default');
    expect(modal).toContain('gitChoices');
    expect(modal).toContain('Select Safe (');
    expect(modal).toContain('Select All (');
    expect(modal).toContain('Clear All');
    expect(modal).toContain('window.confirm(');
    expect(modal).toContain('may replace reviewed local pronunciations or definitions');
    expect(onboarding).toContain(
      'hasResolvedBlockingFlow && activeBlockingModal === null && hasResolvedModelUpgrade',
    );
    expect(appLayout).not.toContain('<DictionaryUpdateModal');
    expect(dockerfile).toContain('scripts/sync-dict-to-git.mjs');
    expect(dockerfile).toContain('default_global_pronunciation_tombstones.json');
    expect(nextConfig).toContain("'/api/tts/dictionary-updates'");
    expect(nextConfig).toContain("'./src/lib/server/default_global_pronunciation_tombstones.json'");
    expect(syncScript).toContain("'scripts/clean-git-pronunciation-library.mjs'");
    expect(syncScript).toContain("'--apply'");
    expect(entrypoint).toContain('if (dictionarySeed.status !== 0)');
  });
});
