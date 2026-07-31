import { describe, expect, test, vi } from 'vitest';
import { fetchGeminiWithRateLimitFallback } from '../../src/lib/server/smart-audio/gemini-failover';

describe('Gemini key failover', () => {
  test.each([429, 503])('uses a distinct backup after HTTP %s', async (status) => {
    const request = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status }))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));

    const result = await fetchGeminiWithRateLimitFallback({
      primaryApiKey: 'primary-placeholder',
      backupApiKey: 'backup-placeholder',
      request,
    });

    expect(result.response.status).toBe(200);
    expect(result.usedBackup).toBe(true);
    expect(request).toHaveBeenNthCalledWith(1, 'primary-placeholder');
    expect(request).toHaveBeenNthCalledWith(2, 'backup-placeholder');
  });

  test('does not retry non-transient errors or duplicate credentials', async () => {
    const ordinaryError = vi.fn().mockResolvedValue(new Response(null, { status: 400 }));
    expect((await fetchGeminiWithRateLimitFallback({
      primaryApiKey: 'same-placeholder',
      backupApiKey: 'backup-placeholder',
      request: ordinaryError,
    })).usedBackup).toBe(false);
    expect(ordinaryError).toHaveBeenCalledTimes(1);

    const duplicateKey = vi.fn().mockResolvedValue(new Response(null, { status: 429 }));
    expect((await fetchGeminiWithRateLimitFallback({
      primaryApiKey: 'same-placeholder',
      backupApiKey: 'same-placeholder',
      request: duplicateKey,
    })).usedBackup).toBe(false);
    expect(duplicateKey).toHaveBeenCalledTimes(1);
  });
});
