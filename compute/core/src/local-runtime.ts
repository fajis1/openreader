import { ensureWhisperModel } from './whisper/model';
import { alignAudioWithText, releaseWhisperRuntime } from './whisper/align';
import { ensureModel as ensurePdfLayoutModel } from './pdf/model';
import { parsePdf } from './pdf/parse';
import { releaseLayoutModelSession } from './pdf/runLayoutModel';
import {
  clearSelectedOnnxProvider,
  getOnnxExecutionProviderConfig,
} from './config/onnx-execution-provider';
import { getComputeJobConcurrency } from './config/cpu-budget';

function shouldReleaseOnnxSessionsAfterJob(workload: 'pdf-layout' | 'whisper'): boolean {
  return getComputeJobConcurrency() === 1
    && getOnnxExecutionProviderConfig(workload).releaseAfterJob;
}

export async function ensureComputeModels(): Promise<void> {
  await Promise.all([ensureWhisperModel(), ensurePdfLayoutModel()]);
}

export async function runWhisperAlignmentFromAudioBuffer(input: {
  audioBuffer: ArrayBuffer;
  text: string;
  cacheKey?: string;
  lang?: string;
}) {
  try {
    const alignments = await alignAudioWithText(
      input.audioBuffer,
      input.text,
      input.cacheKey,
      { lang: input.lang },
    );
    return { alignments };
  } finally {
    if (shouldReleaseOnnxSessionsAfterJob('whisper')) {
      await releaseWhisperRuntime();
      clearSelectedOnnxProvider('whisper');
    }
  }
}

export async function runPdfLayoutFromPdfBuffer(input: {
  documentId: string;
  pdfBytes: ArrayBuffer;
  onPageStarted?: (input: {
    pageNumber: number;
    totalPages: number;
  }) => void | Promise<void>;
  onPageParsed?: (input: {
    pageNumber: number;
    totalPages: number;
    pageMs: number;
  }) => void | Promise<void>;
}) {
  try {
    const parsed = await parsePdf({
      documentId: input.documentId,
      pdfBytes: input.pdfBytes,
      onPageStarted: input.onPageStarted,
      onPageParsed: input.onPageParsed,
    });
    return { parsed };
  } finally {
    if (shouldReleaseOnnxSessionsAfterJob('pdf-layout')) {
      await releaseLayoutModelSession();
      clearSelectedOnnxProvider('pdf-layout');
    }
  }
}
