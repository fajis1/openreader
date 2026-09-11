import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { audiobooks, audiobookChapters, documents } from '@/db/schema';
import { getRuntimeConfig } from '@/lib/server/admin/settings';
import { errorToLog, serverLogger } from '@/lib/server/logger';
import {
  getAudiobookObjectBuffer,
  listAudiobookObjects,
} from './blobstore';
import { getDocumentBlob } from '@/lib/server/documents/blobstore';
import { executeAudiobookCombine } from './combine';
import { listChapterObjects } from './chapters';
import type { TTSAudiobookFormat } from '@/types/tts';

export interface AudiobookshelfFolder {
  id: string;
  fullPath: string;
}

export interface AudiobookshelfLibrary {
  id: string;
  name: string;
  mediaType: string;
  folders: AudiobookshelfFolder[];
}

export interface AudiobookshelfConfig {
  url: string;
  token: string;
  libraryId: string;
  folderId: string;
  autoDetectMetadata: boolean;
  isConfigured: boolean;
}

export interface AudiobookshelfUploadOptions {
  bookId: string;
  userId: string;
  title: string;
  author?: string;
  series?: string;
  includeCompanionDocument?: boolean;
  libraryId?: string;
  folderId?: string;
  namespace?: string | null;
}

export interface AudiobookshelfUploadResult {
  success: boolean;
  title: string;
  author: string;
  libraryId: string;
  folderId: string;
  files: string[];
  scanTriggered: boolean;
}

/**
 * Sanitize strings for Audiobookshelf folder / file naming.
 * Removes illegal filesystem characters, collapses spaces, trims.
 */
export function sanitizeFilenameForAudiobookshelf(name: string): string {
  const sanitized = name
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+|\.+$/g, ''); // strip leading/trailing periods
  return sanitized || 'Untitled';
}

/**
 * Resolves current Audiobookshelf settings from runtime config and environment variables.
 */
export async function resolveAudiobookshelfConfig(): Promise<AudiobookshelfConfig> {
  const runtime = await getRuntimeConfig();

  const url = (runtime.audiobookshelfUrl || process.env.AUDIOBOOKSHELF_URL || 'http://192.168.90.244:13378').trim().replace(/\/+$/, '');
  const token = (runtime.audiobookshelfToken || process.env.AUDIOBOOKSHELF_TOKEN || '').trim();
  const libraryId = (runtime.audiobookshelfLibraryId || process.env.AUDIOBOOKSHELF_LIBRARY_ID || '').trim();
  const folderId = (runtime.audiobookshelfFolderId || process.env.AUDIOBOOKSHELF_FOLDER_ID || '').trim();
  const autoDetectMetadata = runtime.audiobookshelfAutoDetectMetadata ?? true;

  return {
    url,
    token,
    libraryId,
    folderId,
    autoDetectMetadata,
    isConfigured: Boolean(url && token),
  };
}

/**
 * Fetches available libraries and their folders from Audiobookshelf.
 */
export async function fetchAudiobookshelfLibraries(
  urlOverride?: string,
  tokenOverride?: string,
): Promise<AudiobookshelfLibrary[]> {
  const config = await resolveAudiobookshelfConfig();
  const rawUrl = urlOverride || config.url;
  const token = tokenOverride || config.token;

  if (!rawUrl) {
    throw new Error('Audiobookshelf server URL is not configured.');
  }
  if (!token) {
    throw new Error('Audiobookshelf API token is not configured.');
  }

  const normalizedUrl = rawUrl.trim().replace(/\/+$/, '');
  const endpoint = `${normalizedUrl}/api/libraries`;

  const response = await fetch(endpoint, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(`Audiobookshelf API returned ${response.status}: ${errorText || response.statusText}`);
  }

  const data = (await response.json()) as { libraries?: Array<Record<string, unknown>> } | Array<Record<string, unknown>>;
  const rawLibraries = Array.isArray(data) ? data : data.libraries || [];

  return rawLibraries.map((lib): AudiobookshelfLibrary => {
    const rawFolders = (Array.isArray(lib.folders) ? lib.folders : Array.isArray(lib.libraryFolders) ? lib.libraryFolders : []) as Array<Record<string, unknown>>;
    return {
      id: String(lib.id || ''),
      name: String(lib.name || 'Unnamed Library'),
      mediaType: String(lib.mediaType || 'book'),
      folders: rawFolders.map((f) => ({
        id: String(f.id || ''),
        fullPath: String(f.fullPath || f.path || ''),
      })),
    };
  });
}

/**
 * Triggers an immediate library scan in Audiobookshelf so the uploaded files are indexed.
 */
export async function triggerAudiobookshelfScan(
  url: string,
  token: string,
  libraryId: string,
): Promise<boolean> {
  try {
    const normalizedUrl = url.trim().replace(/\/+$/, '');
    const res = await fetch(`${normalizedUrl}/api/libraries/${encodeURIComponent(libraryId)}/scan`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    return res.ok;
  } catch (err) {
    serverLogger.warn({
      event: 'audiobookshelf.scan.trigger_failed',
      error: errorToLog(err),
      libraryId,
    }, 'Failed to trigger Audiobookshelf library scan');
    return false;
  }
}

/**
 * Uploads an audiobook file and companion original document into Audiobookshelf.
 */
export async function uploadBookToAudiobookshelf(
  options: AudiobookshelfUploadOptions,
): Promise<AudiobookshelfUploadResult> {
  const config = await resolveAudiobookshelfConfig();
  if (!config.url || !config.token) {
    throw new Error('Audiobookshelf connection is not configured. Please set the server URL and API token in Admin Settings.');
  }

  const targetLibraryId = options.libraryId || config.libraryId;
  if (!targetLibraryId) {
    throw new Error('No target Audiobookshelf library specified. Please select a library in Admin Settings or in the export dialog.');
  }

  // Resolve target folder ID:
  let targetFolderId = options.folderId || config.folderId;
  if (!targetFolderId) {
    // Look up libraries to select the default folder for this library
    const libraries = await fetchAudiobookshelfLibraries(config.url, config.token);
    const targetLib = libraries.find((l) => l.id === targetLibraryId);
    if (targetLib && targetLib.folders.length > 0) {
      targetFolderId = targetLib.folders[0].id;
    }
  }

  if (!targetFolderId) {
    throw new Error('No folder ID could be resolved for the selected Audiobookshelf library.');
  }

  const { bookId, userId, namespace = null } = options;

  // 1. Verify book and document exist and belong to user
  const bookRows = await db
    .select()
    .from(audiobooks)
    .where(and(eq(audiobooks.id, bookId), eq(audiobooks.userId, userId)));
  if (bookRows.length === 0) {
    throw new Error('Audiobook record not found.');
  }

  const docRows = await db
    .select()
    .from(documents)
    .where(and(eq(documents.id, bookId), eq(documents.userId, userId)));
  const doc = docRows[0] || null;

  // 2. Check for held/rejected chapters
  const objects = await listAudiobookObjects(bookId, userId, namespace);
  const objectNames = objects.map((item) => item.fileName);
  const failedChapters = objectNames.filter((name) => /^\d{1,6}__rejected\.txt$/u.test(name));
  if (failedChapters.length > 0) {
    throw new Error(
      `${failedChapters.length} chapter(s) require review and successful replacement recording before uploading to Audiobookshelf.`,
    );
  }

  const chapters = listChapterObjects(objectNames);
  if (chapters.length === 0) {
    throw new Error('No chapters found for this audiobook.');
  }

  const format: TTSAudiobookFormat = chapters[0].format || 'm4b';
  const completeAudioName = `complete.${format}`;
  const manifestName = `${completeAudioName}.manifest.json`;

  const chapterRows = await db
    .select({
      chapterIndex: audiobookChapters.chapterIndex,
      title: audiobookChapters.title,
    })
    .from(audiobookChapters)
    .where(and(eq(audiobookChapters.bookId, bookId), eq(audiobookChapters.userId, userId)));
  const titleByIndex = new Map<number, string>();
  for (const row of chapterRows) {
    if (row.title.trim()) titleByIndex.set(row.chapterIndex, row.title.trim());
  }

  const signature = chapters.map((chapter) => ({
    index: chapter.index,
    fileName: chapter.fileName,
    title: titleByIndex.get(chapter.index) ?? chapter.title,
  }));

  // 3. Ensure combined audio exists
  let audioBuffer: Buffer | null = null;
  if (objectNames.includes(completeAudioName) && objectNames.includes(manifestName)) {
    try {
      const manifestRaw = await getAudiobookObjectBuffer(bookId, userId, manifestName, namespace);
      const manifest = JSON.parse(manifestRaw.toString('utf8'));
      if (JSON.stringify(manifest) === JSON.stringify(signature)) {
        audioBuffer = await getAudiobookObjectBuffer(bookId, userId, completeAudioName, namespace);
      }
    } catch {
      audioBuffer = null;
    }
  }

  if (!audioBuffer) {
    serverLogger.info(
      { event: 'audiobookshelf.combining_before_upload', bookId },
      'Assembling complete audiobook before Audiobookshelf upload',
    );
    await executeAudiobookCombine(bookId, userId, format, namespace);
    audioBuffer = await getAudiobookObjectBuffer(bookId, userId, completeAudioName, namespace);
  }

  const cleanTitle = sanitizeFilenameForAudiobookshelf(options.title || bookRows[0].title || 'Audiobook');
  const cleanAuthor = sanitizeFilenameForAudiobookshelf(options.author || bookRows[0].author || 'Unknown');
  const cleanSeries = options.series ? sanitizeFilenameForAudiobookshelf(options.series) : undefined;

  const audioFileName = `${cleanTitle}.${format}`;
  const audioMime = format === 'mp3' ? 'audio/mpeg' : 'audio/mp4';

  const filesUploaded: string[] = [audioFileName];

  // 4. Retrieve companion document if requested and available
  let companionBuffer: Buffer | null = null;
  let companionFileName: string | null = null;
  let companionMime = 'application/octet-stream';

  const shouldIncludeCompanion = options.includeCompanionDocument !== false && doc;
  if (shouldIncludeCompanion) {
    try {
      companionBuffer = await getDocumentBlob(doc.id, namespace);
      const rawExt = doc.name.includes('.') ? doc.name.split('.').pop()?.toLowerCase() : doc.type;
      const cleanExt = rawExt && /^[a-z0-9]+$/.test(rawExt) ? rawExt : 'pdf';
      companionFileName = `${cleanTitle}.${cleanExt}`;

      if (cleanExt === 'pdf') companionMime = 'application/pdf';
      else if (cleanExt === 'epub') companionMime = 'application/epub+zip';
      else if (cleanExt === 'docx') companionMime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
      else if (cleanExt === 'txt') companionMime = 'text/plain';

      filesUploaded.push(companionFileName);
    } catch (err) {
      serverLogger.warn(
        { event: 'audiobookshelf.companion_fetch_failed', error: errorToLog(err), bookId },
        'Failed to fetch companion original document; proceeding with audio only',
      );
      companionBuffer = null;
      companionFileName = null;
    }
  }

  // 5. Construct multipart/form-data payload for Audiobookshelf
  const formData = new FormData();
  formData.append('library', targetLibraryId);
  formData.append('folder', targetFolderId);
  formData.append('title', cleanTitle);
  formData.append('author', cleanAuthor);
  if (cleanSeries) {
    formData.append('series', cleanSeries);
  }

  const audioBlob = new Blob([new Uint8Array(audioBuffer)], { type: audioMime });
  formData.append('file', audioBlob, audioFileName);

  if (companionBuffer && companionFileName) {
    const companionBlob = new Blob([new Uint8Array(companionBuffer)], { type: companionMime });
    formData.append('file_companion', companionBlob, companionFileName);
  }

  serverLogger.info(
    {
      event: 'audiobookshelf.uploading',
      url: config.url,
      targetLibraryId,
      targetFolderId,
      title: cleanTitle,
      author: cleanAuthor,
      files: filesUploaded,
    },
    'Uploading audiobook to Audiobookshelf',
  );

  const uploadEndpoint = `${config.url}/api/upload`;
  const uploadResponse = await fetch(uploadEndpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.token}`,
    },
    body: formData,
  });

  if (!uploadResponse.ok) {
    const errText = await uploadResponse.text().catch(() => '');
    serverLogger.error(
      {
        event: 'audiobookshelf.upload_failed',
        status: uploadResponse.status,
        error: errText,
      },
      'Audiobookshelf upload failed',
    );
    throw new Error(`Audiobookshelf upload failed (${uploadResponse.status}): ${errText || uploadResponse.statusText}`);
  }

  // 6. Trigger library scan in background
  const scanTriggered = await triggerAudiobookshelfScan(config.url, config.token, targetLibraryId);

  serverLogger.info(
    {
      event: 'audiobookshelf.upload_success',
      bookId,
      title: cleanTitle,
      filesUploaded,
      scanTriggered,
    },
    'Successfully uploaded audiobook to Audiobookshelf',
  );

  return {
    success: true,
    title: cleanTitle,
    author: cleanAuthor,
    libraryId: targetLibraryId,
    folderId: targetFolderId,
    files: filesUploaded,
    scanTriggered,
  };
}
