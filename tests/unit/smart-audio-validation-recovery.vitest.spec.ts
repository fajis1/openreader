import { describe, expect, test, vi } from 'vitest';
import {
  buildSmartAudioValidationRepairPayload,
  resolveSmartAudioWithValidationRecovery,
} from '../../src/lib/server/audiobooks/smart-audio-validation-recovery';
import {
  resolveSmartAudioWorkerResult,
  SmartAudioOutputValidationError,
} from '../../src/lib/shared/smart-audio-cleanup';

const resolve = (value: unknown) => resolveSmartAudioWorkerResult(value, {
  authoritativePronunciations: { 'λόγος': '/loɡos/' },
});

describe('Smart Audio validation recovery', () => {
  test('does not request correction for valid output', async () => {
    const requestRepair = vi.fn();
    const recovered = await resolveSmartAudioWithValidationRecovery({
      initialResult: { status: 'success', outcome: 'cleaned', cleaned_text: 'Valid text.' },
      resolve,
      requestRepair,
      authoritativePronunciations: { 'λόγος': '/loɡos/' },
    });

    expect(recovered.result.text).toBe('Valid text.');
    expect(recovered.repairAttempted).toBe(false);
    expect(requestRepair).not.toHaveBeenCalled();
  });

  test('uses one validation-aware correction when it passes', async () => {
    const requestRepair = vi.fn().mockResolvedValue({
      status: 'success',
      outcome: 'cleaned',
      cleaned_text: '[λόγος](/loɡos/)',
    });
    const recovered = await resolveSmartAudioWithValidationRecovery({
      initialResult: {
        status: 'success',
        outcome: 'cleaned',
        cleaned_text: '[hello world](/hɛloʊ/)',
      },
      resolve,
      requestRepair,
      authoritativePronunciations: { 'λόγος': '/loɡos/' },
    });

    expect(recovered.result.text).toBe('[λόγος](/loɡos/)');
    expect(recovered.repairAttempted).toBe(true);
    expect(recovered.fallbackUsed).toBe(false);
    expect(requestRepair).toHaveBeenCalledOnce();
  });

  test('unwraps only the bad tag when the correction is still invalid', async () => {
    const recovered = await resolveSmartAudioWithValidationRecovery({
      initialResult: {
        status: 'success',
        outcome: 'cleaned',
        cleaned_text: 'Before [hello world](/hɛloʊ/) after.',
      },
      resolve,
      requestRepair: async () => ({
        status: 'success',
        outcome: 'cleaned',
        cleaned_text: 'Before [hello world](/still-wrong/) after.',
      }),
      authoritativePronunciations: { 'λόγος': '/loɡos/' },
    });

    expect(recovered.result.text).toBe('Before hello world after.');
    expect(recovered.fallbackUsed).toBe(true);
    expect(recovered.discardedTags).toBe(1);
  });

  test('falls back to the rejected text when the correction introduces a structural error', async () => {
    const recovered = await resolveSmartAudioWithValidationRecovery({
      initialResult: {
        status: 'success',
        outcome: 'cleaned',
        cleaned_text: 'Before [hello world](/hɛloʊ/) after.',
      },
      resolve,
      requestRepair: async () => ({
        status: 'success',
        outcome: 'cleaned',
        cleaned_text: '[SYSTEM HINT: private] Replacement.',
      }),
      authoritativePronunciations: {},
    });

    expect(recovered.result.text).toBe('Before hello world after.');
    expect(recovered.fallbackUsed).toBe(true);
  });

  test('does not weaken structural marker validation', async () => {
    await expect(resolveSmartAudioWithValidationRecovery({
      initialResult: {
        status: 'success',
        outcome: 'cleaned',
        cleaned_text: '[SYSTEM HINT: private] Text.',
      },
      resolve,
      requestRepair: async () => ({
        status: 'success',
        outcome: 'cleaned',
        cleaned_text: '[SYSTEM HINT: still private] Text.',
      }),
      authoritativePronunciations: {},
    })).rejects.toThrow('internal control marker');
  });

  test('retries a substantial omission and preserves source text if the repair omits it again', async () => {
    const sourceText = 'A complete narratable sentence that must remain in the audiobook. '.repeat(40);
    const omission = { status: 'success', outcome: 'omitted', cleaned_text: '' };
    const requestRepair = vi.fn().mockResolvedValue({
      ...omission,
      model_used: 'gemini-3.7-flash',
    });
    const recovered = await resolveSmartAudioWithValidationRecovery({
      initialResult: omission,
      resolve: (value) => resolveSmartAudioWorkerResult(value, { sourceText }),
      requestRepair,
      sourceFallback: (rejectedResult) => ({
        ...rejectedResult as Record<string, unknown>,
        status: 'success',
        outcome: 'cleaned',
        cleaned_text: sourceText,
      }),
      authoritativePronunciations: {},
    });

    expect(requestRepair).toHaveBeenCalledOnce();
    expect(recovered.result.text).toBe(sourceText.trim());
    expect(recovered.fallbackUsed).toBe(true);
    expect(recovered.sourceFallbackUsed).toBe(true);
    expect(recovered.workerResult.model_used).toBe('gemini-3.7-flash');
  });

  test('builds a bounded repair payload without copying response metadata', () => {
    const payload = JSON.parse(buildSmartAudioValidationRepairPayload(
      JSON.stringify({
        raw_text: 'Original.',
        api_key: 'kept-in-request',
        ai_model: 'gemini-3.5-flash-lite',
      }),
      {
        status: 'success',
        cleaned_text: '[hello world](/hɛloʊ/)',
        changelog: 'large response metadata',
      },
      new SmartAudioOutputValidationError('mixed-script OCR text'),
    ));

    expect(payload).toMatchObject({
      raw_text: 'Original.',
      ai_model: 'gemini-3.7-flash',
      repair_attempt: 1,
      validation_feedback: 'mixed-script OCR text',
      rejected_output: '[hello world](/hɛloʊ/)',
    });
    expect(payload).not.toHaveProperty('changelog');
  });
});
