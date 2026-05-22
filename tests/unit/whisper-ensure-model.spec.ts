import { test, expect } from '@playwright/test';

test.describe('whisper model bootstrap via local-runtime', () => {
  test('is idempotent across concurrent calls', async () => {
    test.setTimeout(180000);
    const { ensureComputeModels } = await import('@openreader/compute-core/local-runtime');
    await expect(
      Promise.all([
        ensureComputeModels(),
        ensureComputeModels(),
        ensureComputeModels(),
      ]),
    ).resolves.toBeDefined();
  });
});
