import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { beforeEach, describe, expect, test, vi } from 'vitest';

const generateTTSBuffer = vi.hoisted(() => vi.fn());

vi.mock('@/lib/server/tts/generate', () => ({
  generateTTSBuffer,
}));

import { generateSegmentedAudiobookTtsBuffer } from '../../src/lib/server/audiobooks/segmented-tts';
import { AUDIOBOOK_TTS_SEGMENT_MAX_CHARACTERS } from '../../src/lib/shared/audiobook-batching';

describe('segmented audiobook TTS generation', () => {
  beforeEach(async () => {
    generateTTSBuffer.mockReset();
    generateTTSBuffer.mockResolvedValue(
      await readFile(path.join(process.cwd(), 'tests/files/sample.mp3')),
    );
  });

  test('uses multiple bounded TTS requests and returns one valid combined MP3', async () => {
    const text = Array.from(
      { length: 45 },
      (_, index) => `Sentence ${index} ${'spoken words '.repeat(12).trim()}.`,
    ).join(' ');
    expect(text.length).toBeGreaterThan(AUDIOBOOK_TTS_SEGMENT_MAX_CHARACTERS);

    const combined = await generateSegmentedAudiobookTtsBuffer({
      text,
      voice: 'test',
      speed: 1,
      provider: 'test',
      apiKey: 'test-placeholder',
    });
    const requests = generateTTSBuffer.mock.calls.map(([request]) => request);

    expect(requests.length).toBeGreaterThan(1);
    expect(requests.every((request) => (
      request.text.length <= AUDIOBOOK_TTS_SEGMENT_MAX_CHARACTERS
    ))).toBe(true);
    expect(combined.length).toBeGreaterThan(0);
    expect(combined.subarray(0, 3).toString('ascii')).toBe('ID3');
  });
});
