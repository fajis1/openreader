import {
  CURRENT_AUDIOBOOK_BATCH_VERSION,
} from '@/lib/shared/audiobook-batching';
import { removePdfTableOfContents } from '@/lib/shared/audiobook-end-matter';
import {
  DEFAULT_DOCUMENT_SETTINGS,
  type DocumentSettings,
} from '@/types/document-settings';
import type {
  ParsedPdfBlock,
  ParsedPdfDocument,
} from '@/types/parsed-pdf';

export type PdfAudiobookBlock = ParsedPdfBlock & { pageNumber: number };

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
  const blocksAfterKindFilter = pageBlocks.filter((block) => !skipKinds.has(block.kind));
  const tocResult = cleanupBatchVersion === CURRENT_AUDIOBOOK_BATCH_VERSION
    ? removePdfTableOfContents(blocksAfterKindFilter, parsed.pages.length)
    : { blocks: blocksAfterKindFilter, skipped: false };

  return {
    blocks: tocResult.blocks,
    skippedBlockCount: pageBlocks.length - blocksAfterKindFilter.length,
    tocSkipped: tocResult.skipped,
  };
}
