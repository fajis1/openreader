import {
  runPdfLayoutFromPdfBuffer,
  runWhisperAlignmentFromAudioBuffer,
  releaseComputeSessions,
} from '@openreader/compute-core/local-runtime';
import { runWithOnnxProviderObserver } from '@openreader/compute-core/onnx-runtime';

type Request =
  | {
      kind: 'whisper';
      audioBuffer: ArrayBuffer;
      text: string;
      cacheKey?: string;
      lang?: string;
    }
  | {
      kind: 'pdf-layout';
      documentId: string;
      pdfBytes: ArrayBuffer;
    };

type RequestEnvelope = {
  requestId: string;
  keepAlive: boolean;
  request: Request;
};

function send(requestId: string, message: Record<string, unknown>): void {
  if (process.connected) process.send?.({ requestId, ...message });
}

process.on('message', (rawEnvelope) => {
  const { requestId, keepAlive, request } = rawEnvelope as RequestEnvelope;
  void runWithOnnxProviderObserver(
    (selection) => {
      send(requestId, { type: 'provider', selection });
    },
    async () => {
      if (request.kind === 'whisper') {
        return await runWhisperAlignmentFromAudioBuffer(request);
      }
      return await runPdfLayoutFromPdfBuffer({
        documentId: request.documentId,
        pdfBytes: request.pdfBytes,
        onPageStarted: (progress) => send(requestId, { type: 'page-started', ...progress }),
        onPageParsed: (progress) => send(requestId, { type: 'page-parsed', ...progress }),
      });
    },
  ).then(
    (result) => {
      send(requestId, { type: 'result', result });
    },
    (error: unknown) => {
      const normalized = error instanceof Error ? error : new Error(String(error));
      send(requestId, { type: 'error', message: normalized.message, stack: normalized.stack });
    },
  );
});

process.once('disconnect', () => {
  releaseComputeSessions().finally(() => {
    process.exit(0);
  });
});
