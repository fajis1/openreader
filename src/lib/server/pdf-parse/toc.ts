import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

// We just need a stub for standard fonts.
pdfjs.GlobalWorkerOptions.workerSrc = '';

export interface TocEntry {
  title: string;
  pageNumber: number;
}

export async function extractPdfToc(buffer: Buffer): Promise<TocEntry[]> {
  try {
    const doc = await pdfjs.getDocument({
      data: new Uint8Array(buffer),
      standardFontDataUrl: '',
      disableFontFace: true,
    }).promise;

    const outline = await doc.getOutline();
    if (!outline) return [];

    const results: TocEntry[] = [];

    const processNode = async (node: any) => {
      if (node.title) {
        let dest = node.dest;
        if (typeof dest === 'string') {
          dest = await doc.getDestination(dest);
        }
        if (dest && dest.length > 0) {
          try {
            const pageIndex = await doc.getPageIndex(dest[0]);
            results.push({
              title: node.title.trim(),
              pageNumber: pageIndex + 1, // 1-based page number to match ParsedPdfDocument
            });
          } catch (e) {
            // Ignore missing pages
          }
        }
      }
      for (const child of node.items || []) {
        await processNode(child);
      }
    };

    for (const item of outline) {
      await processNode(item);
    }
    return results;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Failed to extract PDF TOC:', err);
    return [];
  }
}

export function computeTocBoundaries(toc: TocEntry[], totalPages: number): { startPage: number; endPage: number } {
  let startPage = 1;
  let endPage = totalPages;

  // Find start matter cutoff (e.g. Foreword, Introduction, Chapter 1, Part 1)
  const chapter1Regex = /^(chapter 1\b|part 1\b|1\.|introduction|foreword|preface|prologue)/i;
  for (const entry of toc) {
    if (chapter1Regex.test(entry.title)) {
      startPage = entry.pageNumber;
      break;
    }
  }

  // Find end matter cutoff (e.g. Bibliography, Index, Works Cited, Notes)
  const endMatterRegex = /^(bibliography|index|indexes|works cited|notes|appendix|glossary)/i;
  for (const entry of toc) {
    // Make sure we don't accidentally match something in the front matter, 
    // it should ideally be in the later half of the book, but we'll just take the first match that is >= startPage
    if (entry.pageNumber >= startPage && endMatterRegex.test(entry.title)) {
      endPage = Math.min(endPage, entry.pageNumber - 1);
      break;
    }
  }

  return { startPage, endPage };
}
