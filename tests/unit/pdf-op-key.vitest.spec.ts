import { describe, expect, test } from 'vitest';
import { PDF_PARSER_VERSION } from '@openreader/compute-core';
import { buildPdfOpKey } from '../../src/lib/server/compute/worker';

describe('pdf worker op key', () => {
  test('includes parser version in the reuse boundary', () => {
    expect(buildPdfOpKey({
      documentId: 'doc-1',
      namespace: null,
      documentObjectKey: 'documents/doc-1.pdf',
    })).toBe(`pdf_layout|v1|${PDF_PARSER_VERSION}|doc-1||documents/doc-1.pdf|`);
  });
});
