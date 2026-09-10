import { describe, expect, test } from 'vitest';
import { expandScholarEditorialWords, hasSplitScholarEditorialWord } from '../../src/lib/shared/scholar-editorial-words';
import { forcefullyTransliterateUntaggedForeignText, reconcileSmartAudioPronunciations, validateSmartAudioOutput } from '../../src/lib/shared/smart-audio-cleanup';
import { hasUntaggedScholarForeignScript, prepareScholarBatchRefineText } from '../../src/lib/server/audiobooks/batch-refine-scholar-safety';
import { resolveSmartAudioWithValidationRecovery } from '../../src/lib/server/audiobooks/smart-audio-validation-recovery';

describe('Scholar internal editorial letters', () => {
  test('ignores standalone Greek punctuation but still catches bare Greek words', () => {
    expect(hasUntaggedScholarForeignScript('those who live [kat](/kɑt/) ᾿ [ἐριθείαν](/ɛriθeɪɑn/)')).toBe(false);
    expect(hasUntaggedScholarForeignScript('those who live [kat](/kɑt/) · [ἐριθείαν](/ɛriθeɪɑn/)')).toBe(false);
    expect(hasUntaggedScholarForeignScript('those who live [kat](/kɑt/) ᾿ ἐριθείαν')).toBe(true);
    expect(() => validateSmartAudioOutput('those who live [kat](/kɑt/) ᾿ [ἐριθείαν](/ɛriθeɪɑn/)')).not.toThrow();
    expect(() => validateSmartAudioOutput('those who live [kat](/kɑt/) ᾿ ἐριθείαν')).toThrow('bare Greek');
  });

  test('expands same-script internal groups only', () => {
    expect(expandScholarEditorialWords('θε(οῦ) θ(ε)ο(ῦ) של(ו)ם')).toBe('θεοῦ θεοῦ שלום');
    expect(forcefullyTransliterateUntaggedForeignText('θε(οῦ)')).toBe('theoy');
    for (const text of ['(θεοῦ)', 'θε (οῦ)', 'θε(οῦ λόγος)', 'θε(οῦ/ός)', 'θε(אב)', 'the(o)', 'aθε(οῦ)']) {
      expect(expandScholarEditorialWords(text)).toBe(text);
    }
  });

  test('rejects partial tags even when every letter has a tag', () => {
    for (const text of ['[θε](/θɛ/)(οῦ)', '[θε](/θɛ/)([οῦ](/u/))', 'θε([οῦ](/u/))', '[של](/ʃl/)([ו](/v/))[ם](/m/)']) {
      expect(hasSplitScholarEditorialWord(text)).toBe(true);
      expect(hasUntaggedScholarForeignScript(text)).toBe(true);
      expect(() => validateSmartAudioOutput(text)).toThrow();
    }
    for (const text of ['[θε(οῦ)](/θɛu/)', '([θεοῦ](/θɛu/))', '[θεοῦ](/θɛu/) ([λόγος](/logos/))']) {
      expect(hasSplitScholarEditorialWord(text)).toBe(false);
      expect(() => validateSmartAudioOutput(text)).not.toThrow();
    }
  });

  test('uses the complete dictionary pronunciation while preserving notation', () => {
    expect(reconcileSmartAudioPronunciations('[θε(οῦ)](/θɛ/)', { 'θεοῦ': '/θɛu/' })).toBe('[θε(οῦ)](/θɛu/)');
    for (const text of ['θε(οῦ)', '[θε](/θɛ/)(οῦ)']) {
      const result = prepareScholarBatchRefineText(text, { 'θε': '/θɛ/', 'θεοῦ': '/θɛu/' });
      expect(result.text).toBe('[θε(οῦ)](/θɛu/)');
      expect(hasUntaggedScholarForeignScript(result.text)).toBe(false);
    }
  });

  test('lets Gemini see unresolved complete editorial words, never a stale partial IPA', () => {
    expect(prepareScholarBatchRefineText('[θε](/θɛ/)(οῦ)', { 'θε': '/θɛ/' }, { preserveUnresolvedEditorialWords: true }).text).toBe('θε(οῦ)');
    const result = prepareScholarBatchRefineText('God (θε(οῦ)).', { 'θε': '/θɛ/' });
    expect(result.text).not.toContain('[θε]');
    expect(result.removedTerms).toEqual(['θε(οῦ)']);
  });

  test('does not let transliteration fallback bypass failed complete-word repair', async () => {
    const candidate = { status: 'success', cleaned_text: '[θε](/θɛ/)(οῦ)' };
    await expect(resolveSmartAudioWithValidationRecovery({
      initialResult: candidate,
      resolve: (value) => validateSmartAudioOutput((value as typeof candidate).cleaned_text),
      requestRepair: async () => candidate,
      authoritativePronunciations: {},
    })).rejects.toThrow('editorial word');
  });
});
