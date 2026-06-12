import {
  createAudiobookChapter,
  getAudiobookStatus,
  withRetry,
  getVoices,
} from '@/lib/client/api/audiobooks';
import type {
  AudiobookGenerationSettings,
  TTSRequestHeaders,
  TTSRetryOptions,
} from '@/types/client';
import type {
  TTSAudiobookChapter,
  TTSAudiobookFormat,
} from '@/types/tts';
import { normalizeTextForTts } from '@/lib/shared/nlp';

export interface PreparedAudiobookChapter {
  index: number;
  title: string;
  text: string;
}

export function batchPreparedChapters(rawChapters: PreparedAudiobookChapter[]): PreparedAudiobookChapter[] {
  const softBatchCharacters = 4000;
  const chapters: PreparedAudiobookChapter[] = [];

  const remoteLog = (message: string) => {
    console.log(message);
    fetch('/api/log', { method: 'POST', body: JSON.stringify({ message }) }).catch(() => {});
  };

  let currentBatchText = '';
  let currentBatchTitle = rawChapters[0]?.title || '';
  let batchIndex = 0;

  for (const item of rawChapters) {
    // We only break the item text into its natural paragraphs
    const paragraphs = item.text.split('\n\n').map(p => p.trim()).filter(Boolean);
    
    remoteLog(`[batchPreparedChapters] Analyzing chapter "${item.title}". Found ${paragraphs.length} paragraphs separated by \\n\\n.`);

    for (let i = 0; i < paragraphs.length; i++) {
      const paragraph = paragraphs[i];
      if (paragraph.length > 6000) {
        remoteLog(`[batchPreparedChapters] ⚠️ Found unusually large paragraph (${paragraph.length} chars) at paragraph index ${i}. This will be passed intact as its own batch.`);
      }

      const addedLength = currentBatchText.length > 0 ? paragraph.length + 2 : paragraph.length;
      
      // If adding this paragraph exceeds the soft limit, and we already have some text in the batch,
      // we finish the current batch and start a new one.
      // This means a single huge paragraph will simply form its own batch.
      if (currentBatchText.length + addedLength > softBatchCharacters && currentBatchText.length > 0) {
        remoteLog(`[batchPreparedChapters] Creating batch ${batchIndex}. Text length: ${currentBatchText.length}`);
        chapters.push({
          title: currentBatchTitle,
          text: currentBatchText,
          index: batchIndex++,
        });
        currentBatchText = paragraph;
        currentBatchTitle = item.title;
      } else {
        currentBatchText += (currentBatchText ? '\n\n' : '') + paragraph;
        // Set title if this is the start of a new batch
        if (currentBatchText === paragraph) {
          currentBatchTitle = item.title;
        }
      }
    }
  }

  // Push whatever is left in the cart at the very end
  if (currentBatchText.length > 0) {
    remoteLog(`[batchPreparedChapters] Creating final batch ${batchIndex}. Text length: ${currentBatchText.length}`);
    chapters.push({
      title: currentBatchTitle,
      text: currentBatchText,
      index: batchIndex++,
    });
  }

  return chapters;
}

export interface AudiobookSourceAdapter {
  prepareChapters: () => Promise<PreparedAudiobookChapter[]>;
  prepareChapter: (chapterIndex: number) => Promise<PreparedAudiobookChapter>;
  noContentMessage: string;
  noAudioGeneratedMessage: string;
}

interface RunAudiobookGenerationOptions {
  adapter: AudiobookSourceAdapter;
  apiKey: string;
  baseUrl: string;
  defaultProvider: string;
  onProgress: (progress: number) => void;
  signal?: AbortSignal;
  onChapterComplete?: (chapter: TTSAudiobookChapter) => void;
  providedBookId?: string;
  format?: TTSAudiobookFormat;
  settings?: AudiobookGenerationSettings;
  retryOptions?: TTSRetryOptions;
}

interface RegenerateAudiobookChapterOptions {
  adapter: AudiobookSourceAdapter;
  chapterIndex: number;
  bookId: string;
  format: TTSAudiobookFormat;
  signal: AbortSignal;
  apiKey: string;
  baseUrl: string;
  defaultProvider: string;
  settings?: AudiobookGenerationSettings;
  retryOptions?: TTSRetryOptions;
}

interface ResolvedAudiobookRequestSettings {
  effectiveProviderRef: string;
  effectiveFormat: TTSAudiobookFormat;
}

function resolveAudiobookRequestSettings(
  settings: AudiobookGenerationSettings | undefined,
  defaultProvider: string,
  format: TTSAudiobookFormat,
): ResolvedAudiobookRequestSettings {
  return {
    effectiveProviderRef: settings?.providerRef ?? defaultProvider,
    effectiveFormat: settings?.format ?? format,
  };
}

function buildAudiobookRequestHeaders(
  apiKey: string,
  baseUrl: string,
  effectiveProvider: string,
): TTSRequestHeaders {
  return {
    'Content-Type': 'application/json',
    'x-openai-key': apiKey,
    'x-openai-base-url': baseUrl,
    'x-tts-provider': effectiveProvider,
  };
}

function isAbortLikeError(error: unknown): boolean {
  return error instanceof Error && (error.name === 'AbortError' || error.message.includes('cancelled'));
}

function createAudiobookAbortError(): Error {
  const error = new Error('Audiobook generation cancelled');
  error.name = 'AbortError';
  return error;
}

let isGenerationRunning = false;
const generationQueue: Array<() => Promise<void>> = [];

async function processGenerationQueue() {
  if (isGenerationRunning) return;
  isGenerationRunning = true;
  while (generationQueue.length > 0) {
    const task = generationQueue.shift();
    if (task) {
      try {
        await task();
      } catch (e) {
        console.error("Background generation task failed", e);
      }
    }
  }
  isGenerationRunning = false;
}

export function runAudiobookGeneration(options: RunAudiobookGenerationOptions): Promise<string> {
  return new Promise((resolve, reject) => {
    generationQueue.push(async () => {
      try {
        const result = await _runAudiobookGeneration(options);
        resolve(result);
      } catch (e) {
        reject(e);
      }
    });
    void processGenerationQueue();
  });
}

async function _runAudiobookGeneration({
  adapter,
  apiKey,
  baseUrl,
  defaultProvider,
  onProgress,
  signal,
  onChapterComplete,
  providedBookId = '',
  format = 'mp3',
  settings,
  retryOptions = {
    maxRetries: 99999, // Infinite retries for server crashes
    initialDelay: 10000, // Start with 10s delay
    maxDelay: 60000, // Max 1 minute between normal retries, ping loop takes over
    backoffFactor: 2,
    postPingDelay: 300000, // 5 minutes
    pingOperation: async () => {
      try {
        const { effectiveProviderRef } = resolveAudiobookRequestSettings(settings, defaultProvider, format);
        const headers = buildAudiobookRequestHeaders(apiKey, baseUrl, effectiveProviderRef);
        await getVoices(headers as HeadersInit);
        return true;
      } catch {
        return false;
      }
    }
  },
}: RunAudiobookGenerationOptions): Promise<string> {
  const rawChapters = (await adapter.prepareChapters()).map((chapter) => ({
    ...chapter,
    text: normalizeTextForTts(chapter.text, { language: settings?.language }),
  }));
  const chapters = batchPreparedChapters(rawChapters);
  const totalLength = chapters.reduce((sum, chapter) => sum + chapter.text.length, 0);
  if (totalLength === 0) {
    throw new Error(adapter.noContentMessage);
  }

  const { effectiveProviderRef, effectiveFormat } = resolveAudiobookRequestSettings(settings, defaultProvider, format);
  const reqHeaders = buildAudiobookRequestHeaders(apiKey, baseUrl, effectiveProviderRef);
  let processedLength = 0;
  let bookId = providedBookId;

  const existingIndices = new Set<number>();
  if (bookId) {
    try {
      const existingData = await getAudiobookStatus(bookId);
      if (existingData.chapters && existingData.chapters.length > 0) {
        for (const chapter of existingData.chapters) {
          if (chapter.status === 'completed') {
            existingIndices.add(chapter.index);
          }
        }
      }
    } catch (error) {
      console.error('Error checking existing chapters:', error);
    }
  }

  for (const chapter of chapters) {
    if (signal?.aborted) {
      throw createAudiobookAbortError();
    }

    const trimmedText = chapter.text.trim();
    if (!trimmedText) {
      continue;
    }

    if (existingIndices.has(chapter.index)) {
      processedLength += trimmedText.length;
      onProgress((processedLength / totalLength) * 100);
      continue;
    }

    try {
      const createdChapter = await withRetry(
        async () => {
          if (signal?.aborted) {
            throw new DOMException('Aborted', 'AbortError');
          }

          return createAudiobookChapter({
            chapterTitle: chapter.title,
            text: trimmedText,
            bookId,
            format: effectiveFormat,
            chapterIndex: chapter.index,
            settings,
          }, reqHeaders, signal);
        },
        retryOptions,
      );

      if (signal?.aborted) {
        throw createAudiobookAbortError();
      }

      if (!bookId) {
        if (createdChapter.bookId) {
          bookId = createdChapter.bookId;
        } else {
          throw new Error('Created chapter is missing bookId');
        }
      }

      onChapterComplete?.(createdChapter);
      processedLength += trimmedText.length;
      onProgress((processedLength / totalLength) * 100);
    } catch (error) {
      if (isAbortLikeError(error)) {
        throw createAudiobookAbortError();
      }

      console.error('Error processing chapter:', error);
      onChapterComplete?.({
        index: chapter.index,
        title: chapter.title,
        status: 'error',
        bookId,
        format: effectiveFormat,
      });
      processedLength += trimmedText.length;
      onProgress((processedLength / totalLength) * 100);
    }
  }

  if (!bookId) {
    throw new Error(adapter.noAudioGeneratedMessage);
  }

  return bookId;
}

export function regenerateAudiobookChapter(options: RegenerateAudiobookChapterOptions): Promise<TTSAudiobookChapter> {
  return new Promise((resolve, reject) => {
    generationQueue.push(async () => {
      try {
        const result = await _regenerateAudiobookChapter(options);
        resolve(result);
      } catch (e) {
        reject(e);
      }
    });
    void processGenerationQueue();
  });
}

async function _regenerateAudiobookChapter({
  adapter,
  chapterIndex,
  bookId,
  format,
  signal,
  apiKey,
  baseUrl,
  defaultProvider,
  settings,
  retryOptions = {
    maxRetries: 99999,
    initialDelay: 10000,
    maxDelay: 60000,
    backoffFactor: 2,
    postPingDelay: 300000,
    pingOperation: async () => {
      try {
        const { effectiveProviderRef } = resolveAudiobookRequestSettings(settings, defaultProvider, format);
        const headers = buildAudiobookRequestHeaders(apiKey, baseUrl, effectiveProviderRef);
        await getVoices(headers as HeadersInit);
        return true;
      } catch {
        return false;
      }
    }
  },
}: RegenerateAudiobookChapterOptions): Promise<TTSAudiobookChapter> {
  const rawChapters = (await adapter.prepareChapters()).map((chapter) => ({
    ...chapter,
    text: normalizeTextForTts(chapter.text, { language: settings?.language }),
  }));
  const chapters = batchPreparedChapters(rawChapters);
  const chapter = chapters.find((c) => c.index === chapterIndex);
  
  if (!chapter) {
    throw new Error('Chapter not found for regeneration');
  }

  const trimmedText = chapter.text.trim();
  if (!trimmedText) {
    throw new Error(adapter.noContentMessage);
  }

  const { effectiveProviderRef, effectiveFormat } = resolveAudiobookRequestSettings(settings, defaultProvider, format);
  const reqHeaders = buildAudiobookRequestHeaders(apiKey, baseUrl, effectiveProviderRef);

  return withRetry(
    async () => {
      if (signal.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }

      return createAudiobookChapter({
        chapterTitle: chapter.title,
        text: trimmedText,
        bookId,
        format: effectiveFormat,
        chapterIndex,
        settings,
      }, reqHeaders, signal);
    },
    retryOptions,
  );
}
