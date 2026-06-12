import { NextRequest, NextResponse } from 'next/server';
import { spawn } from 'child_process';
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { audiobooks, audiobookChapters, audiobookJobs } from '@/db/schema';
import { requireAuthContext } from '@/lib/server/auth/auth';
import { errorToLog, serverLogger } from '@/lib/server/logger';
import { errorResponse } from '@/lib/server/errors/next-response';
import {
  audiobookPrefix,
  deleteAudiobookObject,
  deleteAudiobookPrefix,
  getAudiobookObjectBuffer,
  listAudiobookObjects,
  putAudiobookObject,
} from '@/lib/server/audiobooks/blobstore';
import {
  decodeChapterFileName,
  escapeFFMetadata,
  ffprobeAudio,
} from '@/lib/server/audiobooks/chapters';
import { isS3Configured } from '@/lib/server/storage/s3';
import { getOpenReaderTestNamespace } from '@/lib/server/testing/test-namespace';
import { INTERNAL_WORKER_SECRET } from '@/lib/server/internal-secret';
import { getFFmpegPath } from '@/lib/server/audiobooks/ffmpeg-bin';
import type { TTSAudiobookFormat } from '@/types/tts';

export const dynamic = 'force-dynamic';

type ChapterObject = {
  index: number;
  title: string;
  format: TTSAudiobookFormat;
  fileName: string;
};

const SAFE_ID_REGEX = /^[a-zA-Z0-9._-]{1,128}$/;

function isSafeId(value: string): boolean {
  return SAFE_ID_REGEX.test(value);
}

function s3NotConfiguredResponse(): NextResponse {
  return NextResponse.json(
    { error: 'Audiobooks storage is not configured. Set S3_* environment variables.' },
    { status: 503 },
  );
}

function contentDispositionAttachment(filename: string): string {
  const fallback = filename.replace(/[^\x20-\x7E]/g, '_');
  const encoded = encodeURIComponent(filename);
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

function chapterFileMimeType(format: TTSAudiobookFormat): string {
  return format === 'mp3' ? 'audio/mpeg' : 'audio/mp4';
}

function listChapterObjects(objectNames: string[]): ChapterObject[] {
  const chapters = objectNames
    .filter((name) => !name.startsWith('complete.'))
    .map((fileName) => {
      const decoded = decodeChapterFileName(fileName);
      if (!decoded) return null;
      return {
        index: decoded.index,
        title: decoded.title,
        format: decoded.format,
        fileName,
      } satisfies ChapterObject;
    })
    .filter((value): value is ChapterObject => Boolean(value))
    .sort((a, b) => a.index - b.index);

  const deduped = new Map<number, ChapterObject>();
  for (const chapter of chapters) {
    const existing = deduped.get(chapter.index);
    if (!existing) {
      deduped.set(chapter.index, chapter);
      continue;
    }
    if (chapter.fileName > existing.fileName) {
      deduped.set(chapter.index, chapter);
    }
  }

  return Array.from(deduped.values()).sort((a, b) => a.index - b.index);
}

function streamBuffer(buffer: Buffer): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(buffer));
      controller.close();
    },
  });
}

async function runFFmpeg(args: string[], signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const ffmpeg = spawn(getFFmpegPath(), args);
    let finished = false;

    const onAbort = () => {
      if (finished) return;
      finished = true;
      try {
        ffmpeg.kill('SIGKILL');
      } catch {}
      reject(new Error('ABORTED'));
    };

    if (signal) {
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener('abort', onAbort, { once: true });
    }

    ffmpeg.stderr.on('data', (data) => {
      serverLogger.warn({
        event: 'audiobook.ffmpeg.stderr',
        degraded: true,
        step: 'ffmpeg',
        stderr: String(data),
      }, 'ffmpeg stderr');
    });

    ffmpeg.on('close', (code) => {
      if (finished) return;
      finished = true;
      signal?.removeEventListener('abort', onAbort);
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`FFmpeg process exited with code ${code}`));
      }
    });

    ffmpeg.on('error', (err) => {
      if (finished) return;
      finished = true;
      signal?.removeEventListener('abort', onAbort);
      reject(err);
    });
  });
}

async function ensurePositiveDuration(filePath: string, signal?: AbortSignal): Promise<void> {
  const probe = await ffprobeAudio(filePath, signal);
  if (!probe.durationSec || probe.durationSec <= 0) {
    throw new Error(`Invalid duration for output file: ${filePath}`);
  }
}

export async function GET(request: NextRequest) {
  let workDir: string | null = null;
  try {
    if (!isS3Configured()) return s3NotConfiguredResponse();

    const bookId = request.nextUrl.searchParams.get('bookId');
    const requestedFormat = request.nextUrl.searchParams.get('format') as TTSAudiobookFormat | null;
    if (!bookId) {
      return NextResponse.json({ error: 'Missing bookId parameter' }, { status: 400 });
    }
    if (!isSafeId(bookId)) {
      return NextResponse.json({ error: 'Invalid bookId parameter' }, { status: 400 });
    }

    const internalSecret = request.headers.get('x-internal-secret');
    let storageUserId: string;

    if (internalSecret === INTERNAL_WORKER_SECRET) {
      storageUserId = request.nextUrl.searchParams.get('userId') || '';
      if (!storageUserId) return NextResponse.json({ error: 'Missing userId parameter' }, { status: 400 });
    } else {
      const ctxOrRes = await requireAuthContext(request);
      if (ctxOrRes instanceof Response) return ctxOrRes;
      if (!ctxOrRes.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      storageUserId = ctxOrRes.userId;
    }

    const testNamespace = getOpenReaderTestNamespace(request.headers);
    const existingBookRows = await db
      .select({ userId: audiobooks.userId, title: audiobooks.title })
      .from(audiobooks)
      .where(and(eq(audiobooks.id, bookId), eq(audiobooks.userId, storageUserId)));
    if (existingBookRows.length === 0) {
      return NextResponse.json({ error: 'Book not found' }, { status: 404 });
    }

    const objects = await listAudiobookObjects(bookId, storageUserId, testNamespace);
    const objectNames = objects.map((item) => item.fileName);
    const chapters = listChapterObjects(objectNames);
    if (chapters.length === 0) {
      return NextResponse.json({ error: 'No chapters found' }, { status: 404 });
    }

    const chapterFormats = new Set(chapters.map((chapter) => chapter.format));
    if (chapterFormats.size > 1) {
      return NextResponse.json({ error: 'Mixed chapter formats detected; reset the audiobook to continue' }, { status: 400 });
    }

    const format: TTSAudiobookFormat = requestedFormat ?? chapters[0].format;
    const completeName = `complete.${format}`;
    const manifestName = `${completeName}.manifest.json`;
    const signature = chapters.map((chapter) => ({ index: chapter.index, fileName: chapter.fileName }));

    const rawTitle = existingBookRows[0].title || 'audiobook';
    const safeTitle = rawTitle.replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim();
    const downloadFilename = `${safeTitle}.${format}`;

    if (objectNames.includes(completeName) && objectNames.includes(manifestName)) {
      try {
        const manifest = JSON.parse((await getAudiobookObjectBuffer(bookId, storageUserId, manifestName, testNamespace)).toString('utf8'));
        if (JSON.stringify(manifest) === JSON.stringify(signature)) {
          const cached = await getAudiobookObjectBuffer(bookId, storageUserId, completeName, testNamespace);
          return new NextResponse(streamBuffer(cached), {
            headers: {
              'Content-Type': chapterFileMimeType(format),
              'Content-Disposition': contentDispositionAttachment(downloadFilename),
              'Cache-Control': 'no-cache',
            },
          });
        }
      } catch {
        // Force regeneration below.
      }

      await deleteAudiobookObject(bookId, storageUserId, completeName, testNamespace).catch(() => {});
      await deleteAudiobookObject(bookId, storageUserId, manifestName, testNamespace).catch(() => {});
    }

    const chapterRows = await db
      .select({ chapterIndex: audiobookChapters.chapterIndex, duration: audiobookChapters.duration })
      .from(audiobookChapters)
      .where(and(eq(audiobookChapters.bookId, bookId), eq(audiobookChapters.userId, storageUserId)));
    const durationByIndex = new Map<number, number>();
    for (const row of chapterRows) {
      durationByIndex.set(row.chapterIndex, Number(row.duration ?? 0));
    }

    workDir = await mkdtemp(join(tmpdir(), 'openreader-audiobook-combine-'));
    const metadataPath = join(workDir, 'metadata.txt');
    const listPath = join(workDir, 'list.txt');
    const outputPath = join(workDir, completeName);

    const localChapters: Array<{ index: number; title: string; localPath: string; duration: number }> = [];
    for (const chapter of chapters) {
      const localPath = join(workDir, chapter.fileName);
      const bytes = await getAudiobookObjectBuffer(bookId, storageUserId, chapter.fileName, testNamespace);
      await writeFile(localPath, bytes);

      let duration = 0;
      try {
        const probe = await ffprobeAudio(localPath, request.signal);
        if (probe.durationSec && probe.durationSec > 0) {
          duration = probe.durationSec;
        }
      } catch {
        duration = 0;
      }
      if (!duration || duration <= 0) {
        duration = durationByIndex.get(chapter.index) ?? 0;
      }

      localChapters.push({
        index: chapter.index,
        title: chapter.title,
        localPath,
        duration,
      });
    }

    const metadata: string[] = [];
    let currentTime = 0;
    let currentChapterTitle: string | null = null;
    let currentChapterStartMs = 0;
    const MAX_CHAPTER_DURATION_MS = 35 * 60 * 1000; // 35 minutes
    let currentPartNumber = 1;

    for (let i = 0; i < localChapters.length; i++) {
      const chapter = localChapters[i];
      const startMs = Math.floor(currentTime * 1000);

      const titleChanged = currentChapterTitle !== chapter.title;
      const chapterTooLong = currentChapterTitle !== null && !titleChanged && (startMs - currentChapterStartMs) >= MAX_CHAPTER_DURATION_MS;

      if (titleChanged || chapterTooLong) {
        if (currentChapterTitle !== null) {
          let displayTitle = currentChapterTitle;
          if (currentPartNumber > 1 || chapterTooLong) {
            displayTitle = `${currentChapterTitle} (Part ${currentPartNumber})`;
          }
          metadata.push(
            '[CHAPTER]',
            'TIMEBASE=1/1000',
            `START=${currentChapterStartMs}`,
            `END=${startMs}`,
            `title=${escapeFFMetadata(displayTitle)}`
          );
        }
        if (titleChanged) {
          currentChapterTitle = chapter.title;
          currentPartNumber = 1;
        } else if (chapterTooLong) {
          currentPartNumber++;
        }
        currentChapterStartMs = startMs;
      }

      currentTime += chapter.duration;
    }

    if (currentChapterTitle !== null) {
      const endMs = Math.floor(currentTime * 1000);
      let displayTitle = currentChapterTitle;
      if (currentPartNumber > 1) {
        displayTitle = `${currentChapterTitle} (Part ${currentPartNumber})`;
      }
      metadata.push(
        '[CHAPTER]',
        'TIMEBASE=1/1000',
        `START=${currentChapterStartMs}`,
        `END=${endMs}`,
        `title=${escapeFFMetadata(displayTitle)}`
      );
    }

    await writeFile(metadataPath, ';FFMETADATA1\n' + metadata.join('\n'));
    await writeFile(
      listPath,
      localChapters
        .map((chapter) => `file '${chapter.localPath.replace(/'/g, "'\\''")}'`)
        .join('\n'),
    );

    if (format === 'mp3') {
      try {
        await runFFmpeg(
          ['-f', 'concat', '-safe', '0', '-i', listPath, '-map_metadata', '-1', '-c:a', 'copy', outputPath],
          request.signal,
        );
      } catch (copyError) {
        serverLogger.warn({
          event: 'audiobook.concat_copy.mp3.failed',
          degraded: true,
          fallbackPath: 'reencode',
          error: errorToLog(copyError),
        }, 'MP3 concat copy failed; falling back to re-encode');
        await runFFmpeg(
          ['-f', 'concat', '-safe', '0', '-i', listPath, '-c:a', 'libmp3lame', '-b:a', '64k', outputPath],
          request.signal,
        );
      }
    } else {
      try {
        await runFFmpeg(
          [
            '-f',
            'concat',
            '-safe',
            '0',
            '-i',
            listPath,
            '-i',
            metadataPath,
            '-map_metadata',
            '1',
            '-map_chapters',
            '1',
            '-c:a',
            'copy',
            '-f',
            'mp4',
            outputPath,
          ],
          request.signal,
        );
      } catch (copyError) {
        serverLogger.warn({
          event: 'audiobook.concat_copy.m4b.failed',
          degraded: true,
          fallbackPath: 'reencode',
          error: errorToLog(copyError),
        }, 'M4B concat copy failed; falling back to re-encode');
        await runFFmpeg(
          [
            '-f',
            'concat',
            '-safe',
            '0',
            '-i',
            listPath,
            '-i',
            metadataPath,
            '-map_metadata',
            '1',
            '-map_chapters',
            '1',
            '-c:a',
            'aac',
            '-b:a',
            '64k',
            '-f',
            'mp4',
            outputPath,
          ],
          request.signal,
        );
      }
    }
    await ensurePositiveDuration(outputPath, request.signal);

    const outputBytes = await readFile(outputPath);
    await putAudiobookObject(bookId, storageUserId, completeName, outputBytes, chapterFileMimeType(format), testNamespace);
    await putAudiobookObject(
      bookId,
      storageUserId,
      manifestName,
      Buffer.from(JSON.stringify(signature, null, 2), 'utf8'),
      'application/json; charset=utf-8',
      testNamespace,
    );

    return new NextResponse(streamBuffer(outputBytes), {
      headers: {
        'Content-Type': chapterFileMimeType(format),
        'Content-Disposition': contentDispositionAttachment(downloadFilename),
        'Cache-Control': 'no-cache',
      },
    });
  } catch (error) {
    if ((error as Error)?.message === 'ABORTED' || request.signal.aborted) {
      return NextResponse.json({ error: 'cancelled' }, { status: 499 });
    }
    serverLogger.error({
      event: 'audiobook.create.failed',
      error: errorToLog(error),
    }, 'Failed to create full audiobook');
    return errorResponse(error, {
      apiErrorMessage: 'Failed to create full audiobook file',
      normalize: { code: 'AUDIOBOOK_CREATE_FAILED', errorClass: 'upstream' },
    });
  } finally {
    if (workDir) await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

export async function POST(request: NextRequest) {
  let workDir: string | null = null;
  try {
    if (!isS3Configured()) return s3NotConfiguredResponse();

    const bookId = request.nextUrl.searchParams.get('bookId');
    const requestedFormat = request.nextUrl.searchParams.get('format') as TTSAudiobookFormat | null;
    if (!bookId) {
      return NextResponse.json({ error: 'Missing bookId parameter' }, { status: 400 });
    }
    if (!isSafeId(bookId)) {
      return NextResponse.json({ error: 'Invalid bookId parameter' }, { status: 400 });
    }

    const ctxOrRes = await requireAuthContext(request);
    if (ctxOrRes instanceof Response) return ctxOrRes;
    if (!ctxOrRes.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const storageUserId = ctxOrRes.userId;
    const testNamespace = getOpenReaderTestNamespace(request.headers);
    const existingBookRows = await db
      .select({ userId: audiobooks.userId, title: audiobooks.title })
      .from(audiobooks)
      .where(and(eq(audiobooks.id, bookId), eq(audiobooks.userId, storageUserId)));
    if (existingBookRows.length === 0) {
      return NextResponse.json({ error: 'Book not found' }, { status: 404 });
    }

    const objects = await listAudiobookObjects(bookId, storageUserId, testNamespace);
    const objectNames = objects.map((item) => item.fileName);
    const chapters = listChapterObjects(objectNames);
    if (chapters.length === 0) {
      return NextResponse.json({ error: 'No chapters found' }, { status: 404 });
    }

    const chapterFormats = new Set(chapters.map((chapter) => chapter.format));
    if (chapterFormats.size > 1) {
      return NextResponse.json({ error: 'Mixed chapter formats detected; reset the audiobook to continue' }, { status: 400 });
    }

    const format: TTSAudiobookFormat = requestedFormat ?? chapters[0].format;
    const completeName = `complete.${format}`;
    const manifestName = `${completeName}.manifest.json`;
    const signature = chapters.map((chapter) => ({ index: chapter.index, fileName: chapter.fileName }));

    if (objectNames.includes(completeName) && objectNames.includes(manifestName)) {
      try {
        const manifest = JSON.parse((await getAudiobookObjectBuffer(bookId, storageUserId, manifestName, testNamespace)).toString('utf8'));
        if (JSON.stringify(manifest) === JSON.stringify(signature)) {
          return NextResponse.json({ success: true, message: 'Audiobook already combined' });
        }
      } catch {
        // Force regeneration below.
      }

      await deleteAudiobookObject(bookId, storageUserId, completeName, testNamespace).catch(() => {});
      await deleteAudiobookObject(bookId, storageUserId, manifestName, testNamespace).catch(() => {});
    }

    const chapterRows = await db
      .select({ chapterIndex: audiobookChapters.chapterIndex, duration: audiobookChapters.duration })
      .from(audiobookChapters)
      .where(and(eq(audiobookChapters.bookId, bookId), eq(audiobookChapters.userId, storageUserId)));
    const durationByIndex = new Map<number, number>();
    for (const row of chapterRows) {
      durationByIndex.set(row.chapterIndex, Number(row.duration ?? 0));
    }

    workDir = await mkdtemp(join(tmpdir(), 'openreader-audiobook-combine-'));
    const metadataPath = join(workDir, 'metadata.txt');
    const listPath = join(workDir, 'list.txt');
    const outputPath = join(workDir, completeName);

    const localChapters: Array<{ index: number; title: string; localPath: string; duration: number }> = [];
    for (const chapter of chapters) {
      const localPath = join(workDir, chapter.fileName);
      const bytes = await getAudiobookObjectBuffer(bookId, storageUserId, chapter.fileName, testNamespace);
      await writeFile(localPath, bytes);

      let duration = 0;
      try {
        const probe = await ffprobeAudio(localPath, request.signal);
        if (probe.durationSec && probe.durationSec > 0) {
          duration = probe.durationSec;
        }
      } catch {
        duration = 0;
      }
      if (!duration || duration <= 0) {
        duration = durationByIndex.get(chapter.index) ?? 0;
      }

      localChapters.push({
        index: chapter.index,
        title: chapter.title,
        localPath,
        duration,
      });
    }

    const metadata: string[] = [];
    let currentTime = 0;
    let currentChapterTitle: string | null = null;
    let currentChapterStartMs = 0;

    for (let i = 0; i < localChapters.length; i++) {
      const chapter = localChapters[i];
      const startMs = Math.floor(currentTime * 1000);

      if (currentChapterTitle !== chapter.title) {
        if (currentChapterTitle !== null) {
          metadata.push(
            '[CHAPTER]',
            'TIMEBASE=1/1000',
            `START=${currentChapterStartMs}`,
            `END=${startMs}`,
            `title=${escapeFFMetadata(currentChapterTitle)}`
          );
        }
        currentChapterTitle = chapter.title;
        currentChapterStartMs = startMs;
      }

      currentTime += chapter.duration;
    }

    if (currentChapterTitle !== null) {
      const endMs = Math.floor(currentTime * 1000);
      metadata.push(
        '[CHAPTER]',
        'TIMEBASE=1/1000',
        `START=${currentChapterStartMs}`,
        `END=${endMs}`,
        `title=${escapeFFMetadata(currentChapterTitle)}`
      );
    }

    await writeFile(metadataPath, ';FFMETADATA1\n' + metadata.join('\n'));
    await writeFile(
      listPath,
      localChapters
        .map((chapter) => `file '${chapter.localPath.replace(/'/g, "'\\''")}'`)
        .join('\n'),
    );

    if (format === 'mp3') {
      try {
        await runFFmpeg(
          ['-f', 'concat', '-safe', '0', '-i', listPath, '-map_metadata', '-1', '-c:a', 'copy', outputPath],
          request.signal,
        );
      } catch (copyError) {
        serverLogger.warn({
          event: 'audiobook.concat_copy.mp3.failed',
          degraded: true,
          fallbackPath: 'reencode',
          error: errorToLog(copyError),
        }, 'MP3 concat copy failed; falling back to re-encode');
        await runFFmpeg(
          ['-f', 'concat', '-safe', '0', '-i', listPath, '-c:a', 'libmp3lame', '-b:a', '64k', outputPath],
          request.signal,
        );
      }
    } else {
      try {
        await runFFmpeg(
          [
            '-f',
            'concat',
            '-safe',
            '0',
            '-i',
            listPath,
            '-i',
            metadataPath,
            '-map',
            '0:a',
            '-map_metadata',
            '1',
            '-map_chapters',
            '1',
            '-c:a',
            'copy',
            '-movflags',
            'use_metadata_tags+disable_chpl',
            '-f',
            'mp4',
            outputPath,
          ],
          request.signal,
        );
      } catch (copyError) {
        serverLogger.warn({
          event: 'audiobook.concat_copy.m4b.failed',
          degraded: true,
          fallbackPath: 'reencode',
          error: errorToLog(copyError),
        }, 'M4B concat copy failed; falling back to re-encode');
        await runFFmpeg(
          [
            '-f',
            'concat',
            '-safe',
            '0',
            '-i',
            listPath,
            '-i',
            metadataPath,
            '-map',
            '0:a',
            '-map_metadata',
            '1',
            '-map_chapters',
            '1',
            '-c:a',
            'aac',
            '-b:a',
            '64k',
            '-movflags',
            'use_metadata_tags+disable_chpl',
            '-f',
            'mp4',
            outputPath,
          ],
          request.signal,
        );
      }
    }
    await ensurePositiveDuration(outputPath, request.signal);

    const outputBytes = await readFile(outputPath);
    await putAudiobookObject(bookId, storageUserId, completeName, outputBytes, chapterFileMimeType(format), testNamespace);
    await putAudiobookObject(
      bookId,
      storageUserId,
      manifestName,
      Buffer.from(JSON.stringify(signature, null, 2), 'utf8'),
      'application/json; charset=utf-8',
      testNamespace,
    );

    return NextResponse.json({ success: true, message: 'Audiobook combined successfully' });
  } catch (error) {
    if ((error as Error)?.message === 'ABORTED' || request.signal.aborted) {
      return NextResponse.json({ error: 'cancelled' }, { status: 499 });
    }
    serverLogger.error({
      event: 'audiobook.create.failed',
      error: errorToLog(error),
    }, 'Failed to create full audiobook');
    return errorResponse(error, {
      apiErrorMessage: 'Failed to combine audiobook file',
      normalize: { code: 'AUDIOBOOK_COMBINE_FAILED', errorClass: 'upstream' },
    });
  } finally {
    if (workDir) await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

export async function DELETE(request: NextRequest) {
  try {
    if (!isS3Configured()) return s3NotConfiguredResponse();

    const bookId = request.nextUrl.searchParams.get('bookId');
    if (!bookId) {
      return NextResponse.json({ error: 'Missing bookId parameter' }, { status: 400 });
    }
    if (!isSafeId(bookId)) {
      return NextResponse.json({ error: 'Invalid bookId parameter' }, { status: 400 });
    }

    const ctxOrRes = await requireAuthContext(request);
    if (ctxOrRes instanceof Response) return ctxOrRes;
    if (!ctxOrRes.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const storageUserId = ctxOrRes.userId;
    const testNamespace = getOpenReaderTestNamespace(request.headers);
    const existingBookRows = await db
      .select({ userId: audiobooks.userId })
      .from(audiobooks)
      .where(and(eq(audiobooks.id, bookId), eq(audiobooks.userId, storageUserId)));

    if (existingBookRows.length === 0) {
      return NextResponse.json({ error: 'Book not found' }, { status: 404 });
    }

    await db
      .delete(audiobookChapters)
      .where(and(eq(audiobookChapters.bookId, bookId), eq(audiobookChapters.userId, storageUserId)));

    await db.delete(audiobookJobs).where(and(eq(audiobookJobs.documentId, bookId), eq(audiobookJobs.userId, storageUserId)));

    await db.delete(audiobooks).where(and(eq(audiobooks.id, bookId), eq(audiobooks.userId, storageUserId)));

    const deleted = await deleteAudiobookPrefix(audiobookPrefix(bookId, storageUserId, testNamespace)).catch(() => 0);
    return NextResponse.json({ success: true, existed: deleted > 0 });
  } catch (error) {
    serverLogger.error({
      event: 'audiobook.reset.failed',
      error: errorToLog(error),
    }, 'Failed to reset audiobook');
    return errorResponse(error, {
      apiErrorMessage: 'Failed to reset audiobook',
      normalize: { code: 'AUDIOBOOK_RESET_FAILED', errorClass: 'db' },
    });
  }
}
