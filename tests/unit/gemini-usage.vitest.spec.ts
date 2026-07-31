import { describe, expect, test } from 'vitest';
import { normalizeGeminiTokenUsage } from '../../src/lib/server/smart-audio/gemini-usage';

describe('Gemini token usage', () => {
  test('normalizes REST usage metadata', () => {
    expect(normalizeGeminiTokenUsage({
      promptTokenCount: 120,
      candidatesTokenCount: 80,
      thoughtsTokenCount: 10,
      cachedContentTokenCount: 70,
      totalTokenCount: 210,
    })).toEqual({
      inputTokens: 120,
      outputTokens: 80,
      thinkingTokens: 10,
      cachedInputTokens: 70,
      totalTokens: 210,
    });
  });

  test('normalizes worker usage and safely defaults missing counters', () => {
    expect(normalizeGeminiTokenUsage({
      inputTokens: 50,
      outputTokens: 25,
    })).toEqual({
      inputTokens: 50,
      outputTokens: 25,
      thinkingTokens: 0,
      cachedInputTokens: 0,
      totalTokens: 0,
    });
  });
});
