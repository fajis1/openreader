import { describe, expect, test } from 'vitest';
import {
  buildSmartAudioCleanupPrompt,
  FINAL_SMART_AUDIO_PRONUNCIATION_CHECK,
  isScholarLikeSmartAudioMode,
  normalizeSmartAudioPronunciationTags,
  resolveSmartAudioWorkerResult,
  stripSmartAudioInputMarkers,
} from '../../src/lib/shared/smart-audio-cleanup';

describe('Smart Audio cleanup contract', () => {
  test('appends mandatory runtime rules after a stale saved prompt', () => {
    const prompt = buildSmartAudioCleanupPrompt(
      'Old profile rule: return an empty string when nothing should be narrated.',
    );

    expect(prompt).toContain('Old profile rule: return an empty string');
    expect(prompt).toContain('these rules override conflicting instructions above');
    expect(prompt).toContain('return exactly [OMIT]');
    expect(prompt.lastIndexOf('return exactly [OMIT]')).toBeGreaterThan(
      prompt.indexOf('return an empty string'),
    );
    expect(prompt).toContain('Reconstruct OCR-damaged words when context');
    expect(prompt).toContain('Always output the reconstructed complete word');
    expect(prompt).toContain('Pronunciation markup may wrap exactly one corrected lexical word');
    expect(prompt).toContain('never wrap a phrase, clause, or multiple space-separated words');
    expect(prompt).toContain('Repair contextually clear mixed-script OCR');
    expect(prompt).toContain('Never preserve mixed-script corruption inside a pronunciation tag');
    expect(prompt).toContain('Never evade that rule by wrapping an entire quotation');
    expect(prompt.lastIndexOf('Pronunciation markup may wrap exactly one corrected lexical word')).toBeGreaterThan(
      prompt.indexOf('Old profile rule'),
    );
    expect(FINAL_SMART_AUDIO_PRONUNCIATION_CHECK).toContain(
      "INVALID: [καθ' υἱοθεσίαν δὲ](/kɑθ huioʊθɛsiɑn dɛ/)",
    );
    expect(FINAL_SMART_AUDIO_PRONUNCIATION_CHECK).toContain(
      'VALID: [τὴν](/teɪn/) [θέσιν](/θɛsɪn/)',
    );
    expect(FINAL_SMART_AUDIO_PRONUNCIATION_CHECK).toContain(
      'INVALID: [υἱός](/huɪɒn/)',
    );
    expect(FINAL_SMART_AUDIO_PRONUNCIATION_CHECK).toContain(
      'INVALID: [θετὸν](/θɛtɒs/)',
    );
    expect(FINAL_SMART_AUDIO_PRONUNCIATION_CHECK).toContain(
      'INVALID: [υἱοῦσθαι](/juoʊsθaɪ/)',
    );
  });

  test('removes private input markers without removing their narrative content', () => {
    const source = [
      '[LAYOUT_ENGINE_TAG: PARAGRAPH_TITLE]',
      'A Real Chapter',
      '',
      '[SYSTEM HINT: internal only]',
      'Narrative body.',
      '<openreader-layout kind="text">More prose.</openreader-layout>',
    ].join('\n');

    expect(stripSmartAudioInputMarkers(source)).toBe(
      'A Real Chapter\n\nNarrative body.\nMore prose.',
    );
  });

  test('distinguishes explicit omission from cleaned text', () => {
    expect(resolveSmartAudioWorkerResult({
      status: 'success',
      outcome: 'omitted',
      cleaned_text: '',
    })).toEqual({ outcome: 'omitted', text: '' });

    expect(resolveSmartAudioWorkerResult({
      status: 'success',
      outcome: 'cleaned',
      cleaned_text: 'Narrative body.',
    })).toEqual({ outcome: 'cleaned', text: 'Narrative body.' });
  });

  test('keeps legacy sentinel compatibility but rejects ambiguous empty output', () => {
    expect(resolveSmartAudioWorkerResult({
      status: 'success',
      cleaned_text: '[OMITTED]',
    })).toEqual({ outcome: 'omitted', text: '' });

    expect(() => resolveSmartAudioWorkerResult({
      status: 'success',
      cleaned_text: '',
    })).toThrow('returned empty text instead of [OMIT]');
  });

  test('rejects leaked internal markers before TTS or storage', () => {
    for (const cleanedText of [
      '[LAYOUT_ENGINE_TAG: TEXT]\nNarrative body.',
      '[SYSTEM HINT: internal only]\nNarrative body.',
      '<openreader-layout kind="text">Narrative body.</openreader-layout>',
      'Narrative body.\n\n[CHAPTER_TITLE: Hidden Tag]',
      'Narrative body, then [OMIT].',
    ]) {
      expect(() => resolveSmartAudioWorkerResult({
        status: 'success',
        outcome: 'cleaned',
        cleaned_text: cleanedText,
      })).toThrow('internal control marker');
    }
  });

  test('splits safely aligned phrase pronunciations into individual word tags', () => {
    expect(normalizeSmartAudioPronunciationTags(
      "[καθ' υἱοθεσίαν δὲ](/kɑθ huioʊθɛsiɑn dɛ/)",
    )).toBe("[καθ'](/kɑθ/) [υἱοθεσίαν](/huioʊθɛsiɑn/) [δὲ](/dɛ/)");
    expect(normalizeSmartAudioPronunciationTags(
      '[καὶ τὸ ἄγιον βάπτισμα](/kaɪ toʊ ɑɡioʊn bɑptɪsmɑ/)',
    )).toBe('[καὶ](/kaɪ/) [τὸ](/toʊ/) [ἄγιον](/ɑɡioʊn/) [βάπτισμα](/bɑptɪsmɑ/)');
  });

  test('rejects unalignable phrases and mixed-script OCR before TTS', () => {
    expect(() => normalizeSmartAudioPronunciationTags(
      '[τὴν θέσιν](/teɪn/)',
    )).toThrow('cannot be aligned safely');
    expect(() => normalizeSmartAudioPronunciationTags(
      '[ἄγiov](/ɑɡioʊn/)',
    )).toThrow('mixed-script OCR text');
  });

  test('rejects obvious Greek inflection-ending mismatches', () => {
    expect(() => normalizeSmartAudioPronunciationTags('[υἱός](/huɪɒn/)')).toThrow(
      'does not match the visible Greek inflection ending',
    );
    expect(() => normalizeSmartAudioPronunciationTags('[υἱόν](/huioʊs/)')).toThrow(
      'does not match the visible Greek inflection ending',
    );
    expect(normalizeSmartAudioPronunciationTags('[υἱός](/huioʊs/) [υἱόν](/huioʊn/)')).toBe(
      '[υἱός](/huioʊs/) [υἱόν](/huioʊn/)',
    );
  });

  test('rejects a dropped rough-breathing h from Greek υἱ- words', () => {
    expect(() => normalizeSmartAudioPronunciationTags('[υἱοῦσθαι](/juoʊsθaɪ/)')).toThrow(
      'drops the rough-breathing h',
    );
    expect(normalizeSmartAudioPronunciationTags('[υἱοῦσθαι](/huioʊsθaɪ/)')).toBe(
      '[υἱοῦσθαι](/huioʊsθaɪ/)',
    );
  });

  test('treats Scholar and bibliography-catcher as the same structural mode', () => {
    expect(isScholarLikeSmartAudioMode('scholar')).toBe(true);
    expect(isScholarLikeSmartAudioMode('bibliography-catcher')).toBe(true);
    expect(isScholarLikeSmartAudioMode('standard')).toBe(false);
  });
});
