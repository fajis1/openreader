import { describe, expect, test } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import {
  chapterStartsWithEndMatter,
  extractEpubChapterHeading,
  isAudiobookEndMatterHeading,
  removePdfTableOfContents,
  truncateAudiobookEndMatter,
} from '../../src/lib/shared/audiobook-end-matter';

describe('audiobook end-matter filtering', () => {
  test('recognizes index and bibliography heading variants', () => {
    expect(isAudiobookEndMatterHeading('Index')).toBe(true);
    expect(isAudiobookEndMatterHeading('INDEX (Continued)')).toBe(true);
    expect(isAudiobookEndMatterHeading('Subject Index')).toBe(true);
    expect(isAudiobookEndMatterHeading('Works Cited')).toBe(true);
    expect(isAudiobookEndMatterHeading('The index of grace')).toBe(false);
  });

  test('recognizes an end-matter heading at the start of generic EPUB text', () => {
    expect(chapterStartsWithEndMatter('\n INDEX\nAaron 23\nAbraham 14')).toBe(true);
  });

  test('removes the index and all later chapters before API processing', () => {
    const chapters = [
      { title: 'Chapter 1', text: 'a'.repeat(800) },
      { title: 'Chapter 2', text: 'b'.repeat(800) },
      { title: 'Index (Continued)', text: 'λόγος 42'.repeat(20) },
      { title: 'About the Author', text: 'Later metadata' },
    ];
    expect(truncateAudiobookEndMatter(chapters, 0.5)).toEqual(chapters.slice(0, 2));
  });

  test('removes a PDF contents range while preserving surrounding prose', () => {
    const blocks = [
      { pageNumber: 2, kind: 'text', text: 'Foreword prose that remains.' },
      { pageNumber: 3, kind: 'paragraph_title', text: 'Contents' },
      { pageNumber: 3, kind: 'text', text: 'Chapter One ........ 12' },
      { pageNumber: 4, kind: 'text', text: 'Chapter Twelve ...... 240' },
      { pageNumber: 8, kind: 'paragraph_title', text: 'Chapter One' },
      { pageNumber: 8, kind: 'text', text: `${'Opening prose sentence. '.repeat(18)} More prose.` },
    ];
    const result = removePdfTableOfContents(blocks, 100);
    expect(result.skipped).toBe(true);
    expect(result.blocks.map((block) => block.text)).toEqual([
      'Foreword prose that remains.',
      'Chapter One',
      blocks[5].text,
    ]);
  });

  test('preserves a short first chapter after a multipage PDF contents section', () => {
    const blocks = [
      { pageNumber: 2, kind: 'paragraph_title', text: 'Contents' },
      { pageNumber: 2, kind: 'text', text: 'Chapter One ........ 5' },
      { pageNumber: 3, kind: 'paragraph_title', text: 'Chapter Two 12' },
      { pageNumber: 3, kind: 'text', text: 'Appendix ........ 90' },
      { pageNumber: 5, kind: 'paragraph_title', text: 'Chapter One' },
      { pageNumber: 5, kind: 'text', text: 'A brief opening sentence.' },
      { pageNumber: 6, kind: 'paragraph_title', text: 'Chapter Two' },
      { pageNumber: 6, kind: 'text', text: 'The next chapter begins normally.' },
    ];

    const result = removePdfTableOfContents(blocks, 100);
    expect(result.skipped).toBe(true);
    expect(result.blocks).toEqual(blocks.slice(4));
  });

  test('preserves a first chapter that starts later on the contents page', () => {
    const blocks = [
      { pageNumber: 2, kind: 'paragraph_title', text: 'Contents' },
      { pageNumber: 2, kind: 'text', text: 'Chapter One ........ 2' },
      { pageNumber: 2, kind: 'paragraph_title', text: 'Chapter One' },
      { pageNumber: 2, kind: 'text', text: 'The real chapter begins here.' },
      { pageNumber: 3, kind: 'paragraph_title', text: 'Chapter Two' },
    ];

    const result = removePdfTableOfContents(blocks, 20);
    expect(result.skipped).toBe(true);
    expect(result.blocks).toEqual(blocks.slice(2));
  });

  test('preserves a numbered first chapter when narrative prose follows it', () => {
    const blocks = [
      { pageNumber: 2, kind: 'paragraph_title', text: 'Contents' },
      { pageNumber: 2, kind: 'text', text: 'Chapter 1 ........ 5' },
      { pageNumber: 5, kind: 'paragraph_title', text: 'Chapter 1' },
      { pageNumber: 5, kind: 'text', text: 'A short real chapter begins.' },
      { pageNumber: 6, kind: 'paragraph_title', text: 'Appendix' },
      { pageNumber: 6, kind: 'text', text: 'Appendix narrative follows.' },
    ];

    const result = removePdfTableOfContents(blocks, 30);
    expect(result.skipped).toBe(true);
    expect(result.blocks).toEqual(blocks.slice(2));
  });

  test('prefers an EPUB body heading over the document metadata title', () => {
    expect(extractEpubChapterHeading(`
      <html>
        <head><title>The Same Book Title</title></head>
        <body><h1><span>Bibliography</span></h1><p>Entries follow.</p></body>
      </html>
    `)).toBe('Bibliography');
    expect(extractEpubChapterHeading(
      '<html><head><title>Fallback Chapter</title></head><body><p>Text.</p></body></html>',
    )).toBe('Fallback Chapter');
  });

  test('the EPUB worker retains real headings for end-matter detection', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'src/lib/server/audiobooks/worker.ts'),
      'utf8',
    );
    expect(source).toContain('extractEpubChapterHeading(htmlContent)');
    expect(source).toContain('title: extractedTitle ||');
  });
});
