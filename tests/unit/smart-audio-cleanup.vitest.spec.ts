import { describe, expect, test } from 'vitest';
import {
  buildSmartAudioCleanupPrompt,
  isScholarLikeSmartAudioMode,
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

  test('treats Scholar and bibliography-catcher as the same structural mode', () => {
    expect(isScholarLikeSmartAudioMode('scholar')).toBe(true);
    expect(isScholarLikeSmartAudioMode('bibliography-catcher')).toBe(true);
    expect(isScholarLikeSmartAudioMode('standard')).toBe(false);
  });
});
