import { describe, expect, test } from 'vitest';
import type { BaseDocument, EPUBDocument, HTMLDocument, PDFDocument } from '../../src/types/documents';
import { ensureCachedDocumentCore } from '../../src/lib/client/cache/documents';
import { makeBaseDocument } from './support/document-fixtures';

describe('document-cache-core', () => {
  test('returns cached PDF without downloading', async () => {
    const meta: BaseDocument = makeBaseDocument({
      id: 'pdf1',
      name: 'a.pdf',
      size: 10,
      lastModified: 1_700_000_000_001,
      type: 'pdf',
    });

    let downloads = 0;
    const cached: PDFDocument = { ...meta, type: 'pdf', data: new ArrayBuffer(1) };

    const result = await ensureCachedDocumentCore(meta, {
      get: async () => cached,
      putPdf: async () => { throw new Error('should not put'); },
      putEpub: async () => { throw new Error('should not put'); },
      putHtml: async () => { throw new Error('should not put'); },
      download: async () => {
        downloads++;
        return new ArrayBuffer(0);
      },
      decodeText: () => '',
    });

    expect(downloads).toBe(0);
    expect(result.type).toBe('pdf');
  });

  test('downloads and stores on cache miss (EPUB)', async () => {
    const meta: BaseDocument = makeBaseDocument({
      id: 'epub1',
      name: 'b.epub',
      size: 10,
      lastModified: 1_700_000_000_002,
      type: 'epub',
    });

    const store = new Map<string, PDFDocument | EPUBDocument | HTMLDocument>();
    let downloads = 0;

    const result = await ensureCachedDocumentCore(meta, {
      get: async (m) => store.get(m.id) ?? null,
      putPdf: async () => { /* unused */ },
      putEpub: async (m, data) => {
        store.set(m.id, { ...m, type: 'epub', data } as EPUBDocument);
      },
      putHtml: async () => { /* unused */ },
      download: async () => {
        downloads++;
        return new Uint8Array([1, 2, 3]).buffer;
      },
      decodeText: () => '',
    });

    expect(downloads).toBe(1);
    expect(result.type).toBe('epub');
    expect((result as EPUBDocument).data.byteLength).toBe(3);
  });

  test('downloads, decodes, and stores HTML on cache miss', async () => {
    const meta: BaseDocument = makeBaseDocument({
      id: 'html1',
      name: 'c.txt',
      size: 5,
      lastModified: 1_700_000_000_003,
      type: 'html',
    });

    const store = new Map<string, PDFDocument | EPUBDocument | HTMLDocument>();
    let decodedCalls = 0;

    const result = await ensureCachedDocumentCore(meta, {
      get: async (m) => store.get(m.id) ?? null,
      putPdf: async () => { /* unused */ },
      putEpub: async () => { /* unused */ },
      putHtml: async (m, data) => {
        store.set(m.id, { ...m, type: 'html', data } as HTMLDocument);
      },
      download: async () => new TextEncoder().encode('hello').buffer,
      decodeText: (buf) => {
        decodedCalls++;
        return new TextDecoder().decode(new Uint8Array(buf));
      },
    });

    expect(decodedCalls).toBe(1);
    expect(result.type).toBe('html');
    expect((result as HTMLDocument).data).toBe('hello');
  });

  test('throws deterministic cache error when download succeeds but backend misses persisted PDF', async () => {
    const meta = makeBaseDocument({
      id: 'pdf-cache-miss',
      type: 'pdf',
    });

    await expect(
      ensureCachedDocumentCore(meta, {
        get: async () => null,
        putPdf: async () => { /* simulate write path without persisted row */ },
        putEpub: async () => { /* unused */ },
        putHtml: async () => { /* unused */ },
        download: async () => new Uint8Array([1, 2, 3]).buffer,
        decodeText: () => '',
      }),
    ).rejects.toThrow('Failed to cache PDF');
  });
});
