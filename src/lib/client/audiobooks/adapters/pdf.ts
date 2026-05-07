import type { PDFDocumentProxy } from 'pdfjs-dist';

import { extractTextFromPDF } from '@/lib/client/pdf';
import type { AudiobookSourceAdapter, PreparedAudiobookChapter } from '@/lib/client/audiobooks/pipeline';
import { normalizeTextForTts } from '@/lib/shared/nlp';

interface PdfAudiobookAdapterOptions {
  pdfDocument?: PDFDocumentProxy;
  margins: {
    header: number;
    footer: number;
    left: number;
    right: number;
  };
  smartSentenceSplitting: boolean;
  maxBlockLength?: number;
}

async function extractPreparedPdfChapters({
  pdfDocument,
  margins,
  smartSentenceSplitting,
  maxBlockLength,
}: PdfAudiobookAdapterOptions): Promise<PreparedAudiobookChapter[]> {
  if (!pdfDocument) {
    throw new Error('No PDF document loaded');
  }

  const chapters: PreparedAudiobookChapter[] = [];
  for (let pageNum = 1; pageNum <= pdfDocument.numPages; pageNum++) {
    const rawText = await extractTextFromPDF(pdfDocument, pageNum, margins);
    const trimmedText = rawText.trim();
    if (!trimmedText) {
      continue;
    }

    chapters.push({
      index: chapters.length,
      title: `Page ${chapters.length + 1}`,
      text: smartSentenceSplitting ? normalizeTextForTts(trimmedText, { maxBlockLength }) : trimmedText,
    });
  }

  return chapters;
}

export function createPdfAudiobookSourceAdapter(options: PdfAudiobookAdapterOptions): AudiobookSourceAdapter {
  return {
    noContentMessage: 'No text content found in PDF',
    noAudioGeneratedMessage: 'No audio was generated from the PDF content',
    prepareChapters: async () => extractPreparedPdfChapters(options),
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
