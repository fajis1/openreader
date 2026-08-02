import { describe, expect, test, vi } from 'vitest';
import { fetchGeminiWithRateLimitFallback } from '../../src/lib/server/smart-audio/gemini-failover';

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
});
