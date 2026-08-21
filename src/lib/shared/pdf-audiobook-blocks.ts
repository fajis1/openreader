import {
  CURRENT_AUDIOBOOK_BATCH_VERSION,
} from '@/lib/shared/audiobook-batching';
import {
  AUDIOBOOK_END_MATTER_START_FRACTION,
  isAudiobookEndMatterHeading,
  removePdfTableOfContents,
} from '@/lib/shared/audiobook-end-matter';
import {
  DEFAULT_DOCUMENT_SETTINGS,
  type DocumentSettings,
} from '@/types/document-settings';
import type {
  ParsedPdfBlock,
  ParsedPdfDocument,
} from '@/types/parsed-pdf';

export type PdfAudiobookBlock = ParsedPdfBlock & { pageNumber: number };

type PdfEndMatterResult = {
  blocks: PdfAudiobookBlock[];
  skipped: boolean;
  skippedBlockCount: number;
  startHeading: string | null;
  startPage: number | null;
};

const END_MATTER_HEADING_KINDS = new Set(['header', 'paragraph_title', 'doc_title']);
const REFERENCE_LEAD_HEADING = /^(?:primary|secondary)\s+sources?$/iu;
const REFERENCE_BRIDGE_KINDS = new Set([
  'header',
  'footer',
  'number',
  'reference',
  'reference_content',
]);

function removeConfirmedPdfEndMatter(
  blocks: readonly PdfAudiobookBlock[],
  pages: readonly ParsedPdfDocument['pages'][number][],
): PdfEndMatterResult {
  if (blocks.length === 0 || pages.length === 0) {
    return {
      blocks: [...blocks],
      skipped: false,
      skippedBlockCount: 0,
      startHeading: null,
      startPage: null,
    };
  }

  const latePageNumbers = new Set(
    pages
      .slice(Math.floor(pages.length * AUDIOBOOK_END_MATTER_START_FRACTION))
      .map((page) => page.pageNumber),
  );
  const strongHeadingIndex = blocks.findIndex((block) => (
    latePageNumbers.has(block.pageNumber)
    && END_MATTER_HEADING_KINDS.has(block.kind)
    && isAudiobookEndMatterHeading(block.text)
  ));
  if (strongHeadingIndex < 0) {
    return {
      blocks: [...blocks],
      skipped: false,
      skippedBlockCount: 0,
      startHeading: null,
      startPage: null,
    };
  }

  let startIndex = strongHeadingIndex;
  const strongHeadingPage = blocks[strongHeadingIndex].pageNumber;
  for (let index = strongHeadingIndex - 1; index >= 0; index -= 1) {
    const candidate = blocks[index];
    if (candidate.pageNumber < strongHeadingPage - 2) break;
    if (
      END_MATTER_HEADING_KINDS.has(candidate.kind)
      && REFERENCE_LEAD_HEADING.test(candidate.text.normalize('NFKC').trim())
      && blocks.slice(index + 1, strongHeadingIndex).every((bridge) => (
        REFERENCE_BRIDGE_KINDS.has(bridge.kind) || !bridge.text.trim()
      ))
    ) {
      startIndex = index;
      break;
    }
  }

  return {
    blocks: [...blocks.slice(0, startIndex)],
    skipped: true,
    skippedBlockCount: blocks.length - startIndex,
    startHeading: blocks[startIndex].text.trim() || blocks[strongHeadingIndex].text.trim(),
    startPage: blocks[startIndex].pageNumber,
  };
}

export function preparePdfAudiobookBlocks({
  parsed,
  settings = DEFAULT_DOCUMENT_SETTINGS,
  cleanupBatchVersion,
}: {
  parsed: ParsedPdfDocument;
  settings?: DocumentSettings;
  cleanupBatchVersion?: number;
}): {
  blocks: PdfAudiobookBlock[];
  skippedBlockCount: number;
  tocSkipped: boolean;
  endMatterSkipped: boolean;
  endMatterSkippedBlockCount: number;
  endMatterStartHeading: string | null;
  endMatterStartPage: number | null;
} {
  const skipKinds = new Set(
    settings.pdf?.skipBlockKinds
      ?? DEFAULT_DOCUMENT_SETTINGS.pdf?.skipBlockKinds
      ?? [],
  );
  const pageBlocks = parsed.pages.flatMap((page) => (
    page.blocks.map((block) => ({
      ...block,
      pageNumber: page.pageNumber,
    }))
  ));
  // Detect end matter while PP-DocLayout's original kinds are still available.
  // In particular, a configured `header` filter must not erase a repeated
  // "Bibliography" heading before it can confirm the surrounding references.
  const endMatterResult = cleanupBatchVersion === CURRENT_AUDIOBOOK_BATCH_VERSION
    ? removeConfirmedPdfEndMatter(pageBlocks, parsed.pages)
    : {
        blocks: pageBlocks,
        skipped: false,
        skippedBlockCount: 0,
        startHeading: null,
        startPage: null,
      };
  const blocksAfterKindFilter = endMatterResult.blocks.filter(
    (block) => !skipKinds.has(block.kind),
  );
  const tocResult = cleanupBatchVersion === CURRENT_AUDIOBOOK_BATCH_VERSION
    ? removePdfTableOfContents(blocksAfterKindFilter, parsed.pages.length)
    : { blocks: blocksAfterKindFilter, skipped: false };

  return {
    blocks: tocResult.blocks,
    skippedBlockCount: endMatterResult.blocks.length - blocksAfterKindFilter.length,
    tocSkipped: tocResult.skipped,
    endMatterSkipped: endMatterResult.skipped,
    endMatterSkippedBlockCount: endMatterResult.skippedBlockCount,
    endMatterStartHeading: endMatterResult.startHeading,
    endMatterStartPage: endMatterResult.startPage,
  };
}
