import { describe, expect, test } from 'vitest';
import { createPdfAudiobookSourceAdapter } from '../../src/lib/client/audiobooks/adapters/pdf';
import type { ParsedPdfDocument } from '../../src/types/parsed-pdf';
import type { DocumentSettings } from '../../src/types/document-settings';
import { CURRENT_AUDIOBOOK_BATCH_VERSION } from '../../src/lib/shared/audiobook-batching';
import { preparePdfAudiobookBlocks } from '../../src/lib/shared/pdf-audiobook-blocks';

describe('pdf audiobook adapter', () => {
  test('uses the shared default filter before batching', () => {
    const block = (id: string, kind: 'text' | 'header' | 'footer' | 'footnote' | 'vision_footnote') => ({
      id,
      kind,
      text: id,
      fragments: [{ page: 1, bbox: [0, 0, 100, 20] as [number, number, number, number], text: id, readingOrder: 0 }],
    });
    const parsed: ParsedPdfDocument = {
      schemaVersion: 1,
      documentId: 'doc-default-filter',
      parserVersion: 'test',
      parsedAt: 1,
      pages: [{
        pageNumber: 1,
        width: 100,
        height: 100,
        blocks: [
          block('body', 'text'),
          block('header', 'header'),
          block('footer', 'footer'),
          block('footnote', 'footnote'),
          block('vision-footnote', 'vision_footnote'),
        ],
      }],
    };

    const result = preparePdfAudiobookBlocks({ parsed });
    expect(result.blocks.map((entry) => entry.text)).toEqual(['body']);
    expect(result.skippedBlockCount).toBe(4);
  });

  test('builds chapters from paragraph titles and filters skipped kinds', async () => {
    const parsed: ParsedPdfDocument = {
      schemaVersion: 1,
      documentId: 'doc-1',
      parserVersion: 'test',
      parsedAt: 1_700_000_000_000,
      pages: [
        {
          pageNumber: 1,
          width: 100,
          height: 100,
          blocks: [
            {
              id: 'b1',
              kind: 'paragraph_title',
              text: 'Intro',
              fragments: [{ page: 1, bbox: [0, 80, 100, 90], text: 'Intro', readingOrder: 0 }],
            },
            {
              id: 'b2',
              kind: 'text',
              text: 'Welcome text.',
              fragments: [{ page: 1, bbox: [0, 60, 100, 79], text: 'Welcome text.', readingOrder: 1 }],
            },
            {
              id: 'b3',
              kind: 'header',
              text: 'Header line',
              fragments: [{ page: 1, bbox: [0, 95, 100, 100], text: 'Header line', readingOrder: 2 }],
            },
            {
              id: 'b4',
              kind: 'paragraph_title',
              text: 'Second',
              fragments: [{ page: 1, bbox: [0, 40, 100, 50], text: 'Second', readingOrder: 3 }],
            },
            {
              id: 'b5',
              kind: 'text',
              text: 'More body.',
              fragments: [{ page: 1, bbox: [0, 20, 100, 39], text: 'More body.', readingOrder: 4 }],
            },
          ],
        },
      ],
    };

    const settings: DocumentSettings = {
      schemaVersion: 1,
      pdf: {
        skipBlockKinds: ['header'],
      },
    };

    const adapter = createPdfAudiobookSourceAdapter({
      parsed,
      settings,
    });

    const chapters = await adapter.prepareChapters();
    expect(chapters).toHaveLength(2);
    expect(chapters[0].title).toBe('Intro');
    expect(chapters[0].text).toContain('Welcome text.');
    expect(chapters[0].text).not.toContain('Header line');
    expect(chapters[1].title).toBe('Second');
    expect(chapters[1].text).toContain('More body.');
  });

  test('keeps a single section chapter when only one heading is present', async () => {
    const parsed: ParsedPdfDocument = {
      schemaVersion: 1,
      documentId: 'doc-2',
      parserVersion: 'test',
      parsedAt: 1_700_000_000_001,
      pages: [
        {
          pageNumber: 1,
          width: 100,
          height: 100,
          blocks: [
            {
              id: 'p1-title',
              kind: 'doc_title',
              text: 'Sample PDF',
              fragments: [{ page: 1, bbox: [0, 80, 100, 90], text: 'Sample PDF', readingOrder: 0 }],
            },
            {
              id: 'p1-text',
              kind: 'text',
              text: 'First page body.',
              fragments: [{ page: 1, bbox: [0, 50, 100, 79], text: 'First page body.', readingOrder: 1 }],
            },
          ],
        },
        {
          pageNumber: 2,
          width: 100,
          height: 100,
          blocks: [
            {
              id: 'p2-text',
              kind: 'text',
              text: 'Second page body.',
              fragments: [{ page: 2, bbox: [0, 50, 100, 79], text: 'Second page body.', readingOrder: 0 }],
            },
          ],
        },
      ],
    };

    const settings: DocumentSettings = {
      schemaVersion: 1,
      pdf: {
        skipBlockKinds: [],
      },
    };

    const adapter = createPdfAudiobookSourceAdapter({
      parsed,
      settings,
    });

    const chapters = await adapter.prepareChapters();
    expect(chapters).toHaveLength(1);
    expect(chapters[0].title).toBe('Sample PDF');
    expect(chapters[0].text).toContain('First page body.');
    expect(chapters[0].text).toContain('Second page body.');
  });

  test('uses the same TOC-filtered map for current-version regeneration', async () => {
    const block = (
      id: string,
      kind: 'paragraph_title' | 'text',
      text: string,
      page: number,
    ) => ({
      id,
      kind,
      text,
      fragments: [{ page, bbox: [0, 0, 100, 20] as [number, number, number, number], text, readingOrder: 0 }],
    });
    const parsed: ParsedPdfDocument = {
      schemaVersion: 1,
      documentId: 'doc-toc',
      parserVersion: 'test',
      parsedAt: 1,
      pages: [
        {
          pageNumber: 1,
          width: 100,
          height: 100,
          blocks: [
            block('toc', 'paragraph_title', 'Contents', 1),
            block('toc-entry', 'text', 'Chapter One ........ 3', 1),
          ],
        },
        {
          pageNumber: 3,
          width: 100,
          height: 100,
          blocks: [
            block('chapter', 'paragraph_title', 'Chapter One', 3),
            block('body', 'text', 'A short real chapter begins.', 3),
          ],
        },
      ],
    };
    const adapter = createPdfAudiobookSourceAdapter({
      parsed,
      settings: { schemaVersion: 1, pdf: { skipBlockKinds: [] } },
    });

    const legacy = await adapter.prepareChapters();
    const current = await adapter.prepareChaptersForBatchVersion?.(
      CURRENT_AUDIOBOOK_BATCH_VERSION,
    );
    expect(legacy[0]?.title).toBe('Contents');
    expect(current?.[0]?.title).toBe('Chapter One');
    expect(current?.[0]?.text).toContain('A short real chapter begins.');
  });

  test('removes confirmed PP-DocLayout bibliography blocks before header filtering', () => {
    const makeBlock = (
      id: string,
      kind: 'text' | 'header' | 'paragraph_title' | 'reference' | 'reference_content' | 'number',
      text: string,
      page: number,
    ) => ({
      id,
      kind,
      text,
      fragments: [{ page, bbox: [0, 0, 100, 20] as [number, number, number, number], text, readingOrder: 0 }],
    });
    const parsed: ParsedPdfDocument = {
      schemaVersion: 1,
      documentId: 'doc-bibliography',
      parserVersion: 'test',
      parsedAt: 1,
      pages: Array.from({ length: 10 }, (_, index) => {
        const page = index + 1;
        const blocks = page === 8
          ? [
              makeBlock('primary', 'paragraph_title', 'Primary Sources', page),
              makeBlock('primary-entry', 'reference_content', 'Aristotle. Politics.', page),
            ]
          : page === 9
            ? [
                makeBlock('page-number', 'number', '272', page),
                makeBlock('bibliography-header', 'header', 'Bibliography', page),
                makeBlock('reference', 'reference', 'Augustine. De civitate Dei.', page),
              ]
            : page === 10
              ? [
                  makeBlock('subheading', 'paragraph_title', 'Greco-Roman Texts', page),
                  makeBlock('misclassified-entry', 'text', 'Epictetus. Dissertationes.', page),
                ]
              : [makeBlock(`body-${page}`, 'text', `Narrative page ${page}.`, page)];
        return { pageNumber: page, width: 100, height: 100, blocks };
      }),
    };

    const result = preparePdfAudiobookBlocks({
      parsed,
      settings: { schemaVersion: 1, pdf: { skipBlockKinds: ['header'] } },
      cleanupBatchVersion: CURRENT_AUDIOBOOK_BATCH_VERSION,
    });

    expect(result.endMatterSkipped).toBe(true);
    expect(result.endMatterStartHeading).toBe('Primary Sources');
    expect(result.endMatterStartPage).toBe(8);
    expect(result.endMatterSkippedBlockCount).toBe(7);
    expect(result.blocks.map((block) => block.text)).toEqual([
      'Narrative page 1.',
      'Narrative page 2.',
      'Narrative page 3.',
      'Narrative page 4.',
      'Narrative page 5.',
      'Narrative page 6.',
      'Narrative page 7.',
    ]);
  });

  test('preserves an unconfirmed Primary Sources narrative section', () => {
    const parsed: ParsedPdfDocument = {
      schemaVersion: 1,
      documentId: 'doc-primary-sources-narrative',
      parserVersion: 'test',
      parsedAt: 1,
      pages: Array.from({ length: 10 }, (_, index) => {
        const page = index + 1;
        return {
          pageNumber: page,
          width: 100,
          height: 100,
          blocks: page === 8
            ? [
                {
                  id: 'primary-heading',
                  kind: 'paragraph_title' as const,
                  text: 'Primary Sources',
                  fragments: [{ page, bbox: [0, 0, 100, 20] as [number, number, number, number], text: 'Primary Sources', readingOrder: 0 }],
                },
                {
                  id: 'primary-prose',
                  kind: 'text' as const,
                  text: 'This chapter now compares the primary sources in their historical context.',
                  fragments: [{ page, bbox: [0, 20, 100, 40] as [number, number, number, number], text: 'This chapter now compares the primary sources in their historical context.', readingOrder: 1 }],
                },
              ]
            : [],
        };
      }),
    };

    const result = preparePdfAudiobookBlocks({
      parsed,
      settings: { schemaVersion: 1, pdf: { skipBlockKinds: ['header'] } },
      cleanupBatchVersion: CURRENT_AUDIOBOOK_BATCH_VERSION,
    });

    expect(result.endMatterSkipped).toBe(false);
    expect(result.blocks.map((block) => block.text)).toEqual([
      'Primary Sources',
      'This chapter now compares the primary sources in their historical context.',
    ]);
  });
});
