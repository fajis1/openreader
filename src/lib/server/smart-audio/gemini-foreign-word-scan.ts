import { createHash } from 'node:crypto';

export const GEMINI_FOREIGN_WORD_RESPONSE_JSON_SCHEMA = {
  type: 'array',
  items: {
    type: 'object',
    additionalProperties: false,
    properties: {
      term: {
        type: 'string',
        description: 'The exact term from the request.',
      },
      language: {
        type: 'string',
        enum: ['koine_greek', 'biblical_hebrew', 'other'],
      },
      pronunciations: {
        type: 'array',
        items: { type: 'string' },
        minItems: 1,
        maxItems: 5,
      },
      definition: {
        type: ['string', 'null'],
      },
      confidence: {
        type: 'number',
        minimum: 0,
        maximum: 1,
      },
      needsReview: {
        type: 'boolean',
      },
    },
    required: [
      'term',
      'language',
      'pronunciations',
      'definition',
      'confidence',
      'needsReview',
    ],
  },
} as const;

export interface GeminiForeignWordResult extends Record<string, unknown> {
  term: string;
}

export function foreignWordCandidateCacheKey(input: {
  userId: string;
  documentId: string;
  mode: string;
  target: number;
  query: unknown;
}): string {
  const scopeHash = createHash('sha256')
    .update(JSON.stringify(input))
    .digest('hex');
  return `foreign_word_candidates:v1:${scopeHash}`;
}

export function parseForeignWordCandidateCache(value: unknown): unknown[] | null {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    if (
      !parsed
      || typeof parsed !== 'object'
      || (parsed as { version?: unknown }).version !== 1
      || !Array.isArray((parsed as { words?: unknown }).words)
    ) {
      return null;
    }
    return (parsed as { words: unknown[] }).words;
  } catch {
    return null;
  }
}

export class GeminiHttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'GeminiHttpError';
  }
}

function sanitizeGeminiErrorDetail(value: unknown, secrets: string[]): string {
  const raw = typeof value === 'string' && value.trim()
    ? value.trim()
    : 'No Gemini error detail';
  let sanitized = raw
    .replace(/([?&](?:key|api_key)=)[^&\s]+/gi, '$1[REDACTED]')
    .replace(/[\r\n\t]+/g, ' ');
  for (const secret of secrets) {
    if (secret) sanitized = sanitized.replaceAll(secret, '[REDACTED]');
  }
  return sanitized.slice(0, 1000);
}

export function createGeminiHttpError(
  status: number,
  payload: unknown,
  secrets: string[] = [],
): GeminiHttpError {
  const detail = payload
    && typeof payload === 'object'
    && 'error' in payload
    && payload.error
    && typeof payload.error === 'object'
    && 'message' in payload.error
    ? payload.error.message
    : undefined;
  return new GeminiHttpError(
    status,
    `Gemini request failed (HTTP ${status}): ${sanitizeGeminiErrorDetail(detail, secrets)}`,
  );
}

export function parseGeminiForeignWordResults(text: string): {
  results: GeminiForeignWordResult[];
  repaired: boolean;
} {
  let parsed: unknown;
  let repaired = false;
  try {
    parsed = JSON.parse(text);
  } catch (jsonError) {
    // A token-limited array can still contain complete leading result objects.
    const lastCompleteObject = text.lastIndexOf('}');
    if (lastCompleteObject < 1 || !text.slice(0, lastCompleteObject + 1).trimStart().startsWith('[')) {
      throw jsonError;
    }
    parsed = JSON.parse(`${text.slice(0, lastCompleteObject + 1)}]`);
    repaired = true;
  }

  if (!Array.isArray(parsed)) {
    throw new Error('Gemini returned an invalid pronunciation result: expected a JSON array.');
  }

  const results = parsed.filter((item): item is GeminiForeignWordResult => (
    item !== null
    && typeof item === 'object'
    && !Array.isArray(item)
    && typeof (item as { term?: unknown }).term === 'string'
  ));
  return { results, repaired };
}
