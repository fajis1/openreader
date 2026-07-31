export type GeminiTokenUsage = {
  inputTokens: number;
  outputTokens: number;
  thinkingTokens: number;
  cachedInputTokens: number;
  totalTokens: number;
};

function tokenCount(record: Record<string, unknown>, ...keys: string[]): number {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, value);
  }
  return 0;
}

export function normalizeGeminiTokenUsage(value: unknown): GeminiTokenUsage {
  const record = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return {
    inputTokens: tokenCount(record, 'inputTokens', 'promptTokenCount', 'prompt_token_count'),
    outputTokens: tokenCount(record, 'outputTokens', 'candidatesTokenCount', 'candidates_token_count'),
    thinkingTokens: tokenCount(record, 'thinkingTokens', 'thoughtsTokenCount', 'thoughts_token_count'),
    cachedInputTokens: tokenCount(
      record,
      'cachedInputTokens',
      'cachedContentTokenCount',
      'cached_content_token_count',
    ),
    totalTokens: tokenCount(record, 'totalTokens', 'totalTokenCount', 'total_token_count'),
  };
}
