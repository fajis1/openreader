import { describe, expect, test } from 'vitest';
import { PDF_PARSER_VERSION } from '@openreader/compute-core';
import {
  normalizeDocumentParseStateForCurrentParserVersion,
  parseDocumentParseState,
  stringifyDocumentParseState,
} from '../../src/lib/server/documents/parse-state';

describe('document parse state parser-version handling', () => {
  test('preserves parserVersion through stringify/parse', () => {
    const state = parseDocumentParseState(stringifyDocumentParseState({
      status: 'ready',
      progress: null,
      updatedAt: 1234,
      parserVersion: PDF_PARSER_VERSION,
    }));

    expect(state).toEqual({
      status: 'ready',
      progress: null,
      updatedAt: 1234,
      parserVersion: PDF_PARSER_VERSION,
    });
  });

  test('invalidates ready and inflight states from older parser versions', () => {
    expect(normalizeDocumentParseStateForCurrentParserVersion({
      status: 'ready',
      progress: null,
      updatedAt: 1111,
      parserVersion: 'old-parser',
      opId: 'op-old',
    }, 2222)).toEqual({
      status: 'pending',
      progress: null,
      updatedAt: 2222,
    });

    expect(normalizeDocumentParseStateForCurrentParserVersion({
      status: 'running',
      progress: {
        totalPages: 10,
        pagesParsed: 3,
        currentPage: 4,
        phase: 'infer',
      },
      updatedAt: 1111,
      parserVersion: 'old-parser',
      opId: 'op-old',
    }, 3333)).toEqual({
      status: 'pending',
      progress: null,
      updatedAt: 3333,
    });
  });

  test('keeps failed states and current-version ready states intact', () => {
    expect(normalizeDocumentParseStateForCurrentParserVersion({
      status: 'failed',
      progress: null,
      updatedAt: 1111,
      error: 'no text layer',
      parserVersion: 'old-parser',
    })).toEqual({
      status: 'failed',
      progress: null,
      updatedAt: 1111,
      error: 'no text layer',
      parserVersion: 'old-parser',
    });

    expect(normalizeDocumentParseStateForCurrentParserVersion({
      status: 'ready',
      progress: null,
      updatedAt: 1111,
      parserVersion: PDF_PARSER_VERSION,
    })).toEqual({
      status: 'ready',
      progress: null,
      updatedAt: 1111,
      parserVersion: PDF_PARSER_VERSION,
    });
  });
});
