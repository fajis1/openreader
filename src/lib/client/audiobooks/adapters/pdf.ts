import type { AudiobookSourceAdapter, PreparedAudiobookChapter } from '@/lib/client/audiobooks/pipeline';
import { normalizeTextForTts } from '@/lib/shared/nlp';
import type { ParsedPdfDocument, ParsedPdfBlock } from '@/types/parsed-pdf';
import type { DocumentSettings } from '@/types/document-settings';
import { DEFAULT_DOCUMENT_SETTINGS } from '@/types/document-settings';
import { preparePdfAudiobookBlocks } from '@/lib/shared/pdf-audiobook-blocks';

interface PdfAudiobookAdapterOptions {
  parsed?: ParsedPdfDocument;
  settings?: DocumentSettings;
  maxBlockLength?: number;
  cleanupBatchVersion?: number;
}

function chapterTextFromBlocks(
  blocks: ParsedPdfBlock[],
  maxBlockLength?: number,
): string {
  const text = blocks
    .map((block) => block.text.trim())
    .filter(Boolean)
    .join('\n\n');
  if (!text) return '';
  return normalizeTextForTts(text, { maxBlockLength });
}

function prepareParsedChapters({
  parsed,
  settings,
  maxBlockLength,
  cleanupBatchVersion,
}: {
  parsed: ParsedPdfDocument;
  settings: DocumentSettings;
  maxBlockLength?: number;
  cleanupBatchVersion?: number;
}): PreparedAudiobookChapter[] {
  const allBlocks = preparePdfAudiobookBlocks({
    parsed,
    settings,
    cleanupBatchVersion,
  }).blocks;
  if (!allBlocks.length) return [];

  const chapters: PreparedAudiobookChapter[] = [];
  let currentTitle = 'Introduction';
  let currentBlocks: ParsedPdfBlock[] = [];

  const chapterBoundaryKinds = new Set<string>(['paragraph_title', 'doc_title']);

  const flush = () => {
    if (!currentBlocks.length) return;
    const text = chapterTextFromBlocks(currentBlocks, maxBlockLength);
    if (text) {
      chapters.push({
        index: chapters.length,
        title: currentTitle,
        text,
      });
    }
    currentBlocks = [];
  };

  for (const block of allBlocks) {
    if (chapterBoundaryKinds.has(block.kind)) {
      flush();
      currentTitle = block.text.trim() || `Chapter ${chapters.length + 1}`;
      currentBlocks.push(block);
      continue;
    }
    currentBlocks.push(block);
  }
  flush();

  return chapters;
}

async function extractPreparedPdfChapters({
  parsed,
  settings = DEFAULT_DOCUMENT_SETTINGS,
  maxBlockLength,
  cleanupBatchVersion,
}: PdfAudiobookAdapterOptions): Promise<PreparedAudiobookChapter[]> {
  if (!parsed) {
    throw new Error('PDF parsing is not ready yet.');
  }

  return prepareParsedChapters({
    parsed,
    settings,
    maxBlockLength,
    cleanupBatchVersion,
  });
}

export function createPdfAudiobookSourceAdapter(options: PdfAudiobookAdapterOptions): AudiobookSourceAdapter {
  return {
    noContentMessage: 'No text content found in PDF',
    noAudioGeneratedMessage: 'No audio was generated from the PDF content',
    prepareChapters: async () => extractPreparedPdfChapters(options),
    prepareChaptersForBatchVersion: async (cleanupBatchVersion) => (
      extractPreparedPdfChapters({ ...options, cleanupBatchVersion })
    ),
    prepareChapter: async (chapterIndex: number) => {
      const chapters = await extractPreparedPdfChapters(options);
      const chapter = chapters[chapterIndex];
      if (!chapter) {
        throw new Error('Invalid chapter index');
      }
      return chapter;
    },
  };
}
