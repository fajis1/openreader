import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  createGeminiHttpError,
  foreignWordCandidateCacheKey,
  findLatestForeignWordScanJob,
  GEMINI_FOREIGN_WORD_RESPONSE_JSON_SCHEMA,
  GeminiHttpError,
  parseForeignWordCandidateCache,
  parseGeminiForeignWordResults,
} from '@/lib/server/smart-audio/gemini-foreign-word-scan';

describe('Gemini foreign-word structured output', () => {
  test('uses a lowercase JSON Schema array with explicit term fields', () => {
    expect(GEMINI_FOREIGN_WORD_RESPONSE_JSON_SCHEMA.type).toBe('array');
    expect(GEMINI_FOREIGN_WORD_RESPONSE_JSON_SCHEMA.items.type).toBe('object');
    expect(GEMINI_FOREIGN_WORD_RESPONSE_JSON_SCHEMA.items.properties.term.type).toBe('string');
    expect(GEMINI_FOREIGN_WORD_RESPONSE_JSON_SCHEMA.items.required).toContain('term');
  });

  test('parses result arrays and recovers complete entries from truncation', () => {
    const complete = JSON.stringify([{
      term: 'λόγος',
      pronunciations: ['/loʊɡɒs/'],
    }]);
    expect(parseGeminiForeignWordResults(complete)).toEqual({
      results: [{ term: 'λόγος', pronunciations: ['/loʊɡɒs/'] }],
      repaired: false,
    });

    expect(parseGeminiForeignWordResults(`[${JSON.stringify({
      term: 'λόγος',
      pronunciations: ['/loʊɡɒs/'],
    })}, {"term":`)).toEqual({
      results: [{ term: 'λόγος', pronunciations: ['/loʊɡɒs/'] }],
      repaired: true,
    });
  });

  test('rejects the legacy dynamic object response shape', () => {
    expect(() => parseGeminiForeignWordResults(JSON.stringify({
      λόγος: { pronunciations: ['/loʊɡɒs/'] },
    }))).toThrow('expected a JSON array');
  });

  test('preserves useful HTTP details while redacting keys', () => {
    const error = createGeminiHttpError(400, {
      error: { message: 'Invalid schema for key=secret-key\nadditionalProperties' },
    }, ['secret-key']);
    expect(error).toBeInstanceOf(GeminiHttpError);
    expect(error.status).toBe(400);
    expect(error.message).toBe(
      'Gemini request failed (HTTP 400): Invalid schema for key=[REDACTED] additionalProperties',
    );
  });

  test('scopes cached PDF candidates to the user, document, and scan options', () => {
    const base = {
      userId: 'user-a',
      documentId: 'document-a',
      mode: 'all_foreign',
      target: 80,
      query: null,
    };
    expect(foreignWordCandidateCacheKey(base)).toBe(foreignWordCandidateCacheKey(base));
    expect(foreignWordCandidateCacheKey(base)).not.toBe(foreignWordCandidateCacheKey({
      ...base,
      mode: 'greek_hebrew',
    }));
    expect(parseForeignWordCandidateCache(JSON.stringify({
      version: 1,
      words: [{ word: 'λόγος' }],
    }))).toEqual([{ word: 'λόγος' }]);
    expect(parseForeignWordCandidateCache('{invalid')).toBeNull();
  });

  test('stops and fails the job after a deterministic Gemini HTTP 400', () => {
    const route = readFileSync(resolve(
      process.cwd(),
      'src/app/api/documents/scan-foreign-words/route.ts',
    ), 'utf8');
    expect(route).toContain('err instanceof GeminiHttpError && err.status === 400');
    expect(route).toContain('terminalGeminiError = message;');
    expect(route).toContain("status: terminalGeminiError ? 'failed' : 'completed'");
  });

  test('finds an active scan for the requested user and document', () => {
    const jobs = [
      JSON.stringify({ id: 'other-user', userId: 'user-b', documentId: 'doc-a', status: 'running', updatedAt: 30 }),
      JSON.stringify({ id: 'completed', userId: 'user-a', documentId: 'doc-a', status: 'completed', updatedAt: 20 }),
      JSON.stringify({ id: 'active', userId: 'user-a', documentId: 'doc-a', status: 'running', updatedAt: 10 }),
    ];
    expect(findLatestForeignWordScanJob(jobs, 'user-a', 'doc-a')?.id).toBe('active');
    expect(findLatestForeignWordScanJob(jobs, 'user-b', 'doc-a')?.id).toBe('other-user');
    expect(findLatestForeignWordScanJob(jobs, 'user-a', 'doc-b')).toBeNull();
  });

  test('reattaches to exactly one active legacy scan without guessing between several', () => {
    const oneLegacy = [
      { id: 'legacy', userId: 'user-a', status: 'running', updatedAt: 10 },
    ];
    expect(findLatestForeignWordScanJob(oneLegacy, 'user-a', 'doc-a')?.id).toBe('legacy');
    expect(findLatestForeignWordScanJob([
      ...oneLegacy,
      { id: 'legacy-2', userId: 'user-a', status: 'queued', updatedAt: 20 },
    ], 'user-a', 'doc-a')).toBeNull();
  });
});
