import { describe, expect, test } from 'vitest';
import { applyPronunciationPatches, assertPronunciationRepair, canonicalRepairTextFile, scanPronunciationIssues } from '../../src/lib/shared/pronunciation-issues';
import { reconcileSmartAudioPronunciations } from '../../src/lib/shared/smart-audio-cleanup';

const dictionary = { Aetherian: '/eɪθɪriən/', 'θεοῦ': '/θɛu/' };

describe('targeted pronunciation scan and patches', () => {
  test('finds and repairs malformed single-word IPA from an exact safe dictionary match', () => {
    const text = 'The [Aetherian](/bad split/) arrived.';
    const issues = scanPronunciationIssues(text, dictionary);
    expect(issues).toHaveLength(1);
    expect(issues[0].replacement).toBe('[Aetherian](/eɪθɪriən/)');
    const proposed = applyPronunciationPatches(text, issues, [{ id: issues[0].id, replacement: issues[0].replacement! }]);
    expect(proposed).toBe('The [Aetherian](/eɪθɪriən/) arrived.');
    expect(() => assertPronunciationRepair(text, proposed)).not.toThrow();
    expect(reconcileSmartAudioPronunciations(text, dictionary)).toBe(proposed);
  });

  test('catches the real mixed Greek example without treating English as a repair region', () => {
    const text = String.raw`from the gifts of God ([\ἐκ](/ɛk/) τῶν τοῦ [θε](/θɛ/)(οῦ) δωρεῶν).`;
    const issues = scanPronunciationIssues(text, dictionary);
    expect(issues.some(issue => issue.text.includes('[\\ἐκ]'))).toBe(true);
    expect(issues.some(issue => issue.text === 'τῶν')).toBe(true);
    expect(issues.some(issue => issue.text === 'τοῦ')).toBe(true);
    expect(issues.some(issue => issue.text.includes('[θε](/θɛ/)(οῦ)') && issue.replacement === '[θε(οῦ)](/θɛu/)')).toBe(true);
    expect(issues.some(issue => issue.text === 'δωρεῶν')).toBe(true);
    expect(issues.every(issue => !issue.text.includes('gifts'))).toBe(true);
  });

  test('retains complete tags and ordinary links; flags empty punctuation and broken tags', () => {
    expect(scanPronunciationIssues('A [link](https://example.org) and [θε(οῦ)](/θɛu/).')).toEqual([]);
    expect(scanPronunciationIssues('God ([θεοῦ](/θɛu/)).')).toEqual([]);
    expect(scanPronunciationIssues('word () end')).toMatchObject([{ text: '()', replacement: '' }]);
    expect(scanPronunciationIssues('[Aetherian](/bad')).toHaveLength(1);
  });

  test('requires review for unknown pronunciations and finds Hebrew', () => {
    const issues = scanPronunciationIssues('Read שלום now.');
    expect(issues).toHaveLength(1);
    expect(issues[0].replacement).toBeUndefined();
    expect(issues[0].context).toBe('Read שלום now.');
  });

  test('rejects duplicate patches, unrelated English edits, numbers, and new voices', () => {
    const text = 'The [Aetherian](/bad split/) has 85 coins.';
    const issues = scanPronunciationIssues(text, dictionary);
    const good = { id: '0', replacement: '[Aetherian](/eɪθɪriən/)' };
    expect(() => applyPronunciationPatches(text, issues, [good, good])).toThrow('duplicate');
    expect(() => applyPronunciationPatches(text, issues, [{ ...good, replacement: 'Someone' }])).toThrow('English');
    expect(() => applyPronunciationPatches(text, issues, [{ ...good, replacement: '<voice name="af_bella">Aetherian</voice>' }])).toThrow('voice');
    const proposed = applyPronunciationPatches(text, issues, [good]);
    expect(() => assertPronunciationRepair(text, proposed.replace('85', '86'))).toThrow();
    expect(() => assertPronunciationRepair(text, proposed.replace('coins', 'dollars'))).toThrow();
    expect(() => applyPronunciationPatches(text.replace('Aetherian', 'Another'), issues, [good])).toThrow('changed');
  });

  test('preserves Audio Drama speaker boundaries and rejects unrepaired output', () => {
    const text = '<voice name="af_bella">The [Aetherian](/bad split/) came.</voice>\n<voice name="am_adam">Hello.</voice>';
    const issues = scanPronunciationIssues(text, dictionary);
    const proposed = applyPronunciationPatches(text, issues, [{ id: '0', replacement: issues[0].replacement! }]);
    expect(() => assertPronunciationRepair(text, proposed)).not.toThrow();
    expect(() => assertPronunciationRepair(text, proposed.replace('am_adam', 'af_bella'))).toThrow();
    expect(() => assertPronunciationRepair(text, text)).toThrow('remain');
    expect(canonicalRepairTextFile('0107__rejected.txt')).toBe('0107__text.txt');
  });
});
