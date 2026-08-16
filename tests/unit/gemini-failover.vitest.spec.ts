import { describe, expect, test, vi } from 'vitest';
import {
  fetchGeminiWithRateLimitFallback,
  isGeminiModelUnavailableResponse,
} from '../../src/lib/server/smart-audio/gemini-failover';

describe('Gemini key failover', () => {
  test.each([429, 503])('uses a distinct backup after HTTP %s', async (status) => {
    const request = vi.fn();
    // Primary key fails 8 attempts with status, 9th attempt (backup key) succeeds with 200
    for (let i = 0; i < 8; i += 1) {
      request.mockResolvedValueOnce(new Response(null, { status }));
    }
    request.mockResolvedValueOnce(new Response('ok', { status: 200 }));

    const result = await fetchGeminiWithRateLimitFallback({
      primaryApiKey: 'primary-placeholder',
      backupApiKey: 'backup-placeholder',
      request,
      initialDelayMs: 0,
    });

    expect(result.response.status).toBe(200);
    expect(result.usedBackup).toBe(true);
    expect(request).toHaveBeenNthCalledWith(1, 'primary-placeholder');
    expect(request).toHaveBeenNthCalledWith(9, 'backup-placeholder');
  });

  test('does not retry non-transient errors or duplicate credentials', async () => {
    const ordinaryError = vi.fn().mockResolvedValue(new Response(null, { status: 400 }));
    expect((await fetchGeminiWithRateLimitFallback({
      primaryApiKey: 'same-placeholder',
      backupApiKey: 'backup-placeholder',
      request: ordinaryError,
      initialDelayMs: 0,
    })).usedBackup).toBe(false);
    expect(ordinaryError).toHaveBeenCalledTimes(1);

    const duplicateKey = vi.fn().mockResolvedValue(new Response(null, { status: 429 }));
    expect((await fetchGeminiWithRateLimitFallback({
      primaryApiKey: 'same-placeholder',
      backupApiKey: 'same-placeholder',
      request: duplicateKey,
      initialDelayMs: 0,
    })).usedBackup).toBe(false);
    expect(duplicateKey).toHaveBeenCalledTimes(8);
  });

  test('falls back through the explicit model chain on a definitive unavailable-model error', async () => {
    const request = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        error: { message: 'models/gemini-3.7-flash is not found for API version v1beta, or is not supported for generateContent' },
      }), { status: 404 }))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));
    const onStatusUpdate = vi.fn();

    const result = await fetchGeminiWithRateLimitFallback({
      primaryApiKey: 'primary-placeholder',
      requestedModel: 'gemini-3.7-flash',
      request,
      onStatusUpdate,
      initialDelayMs: 0,
    });

    expect(result.response.status).toBe(200);
    expect(result.requestedModel).toBe('gemini-3.7-flash');
    expect(result.usedModel).toBe('gemini-3.6-flash');
    expect(result.usedModelFallback).toBe(true);
    expect(request).toHaveBeenNthCalledWith(1, 'primary-placeholder', 'gemini-3.7-flash');
    expect(request).toHaveBeenNthCalledWith(2, 'primary-placeholder', 'gemini-3.6-flash');
    expect(onStatusUpdate).toHaveBeenCalledWith(
      'gemini-3.7-flash is unavailable for this Gemini API project. Using gemini-3.6-flash for this request.',
    );
  });

  test('does not hide credentials, quota, transient, or ordinary bad-request errors behind a model change', async () => {
    for (const response of [
      new Response('forbidden', { status: 403 }),
      new Response('quota exceeded', { status: 429 }),
      new Response('temporarily unavailable', { status: 503 }),
      new Response('invalid generation config', { status: 400 }),
    ]) {
      expect(await isGeminiModelUnavailableResponse(response)).toBe(false);
    }
  });
});
