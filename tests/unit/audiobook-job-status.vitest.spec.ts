import { describe, expect, test } from 'vitest';
import {
  GEMINI_RATE_LIMIT_PAUSE_MESSAGE,
  isGeminiRateLimitPause,
} from '../../src/lib/shared/audiobook-job-status';

describe('audiobook job status', () => {
  test('distinguishes a Gemini quota pause from a normal error', () => {
    expect(isGeminiRateLimitPause(GEMINI_RATE_LIMIT_PAUSE_MESSAGE)).toBe(true);
    expect(isGeminiRateLimitPause('S3 upload failed')).toBe(false);
    expect(isGeminiRateLimitPause(null)).toBe(false);
  });
});
