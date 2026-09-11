import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import { audiobooks, documents } from '@/db/schema';
import { getRuntimeConfig } from '@/lib/server/admin/settings';
import { errorToLog, serverLogger } from '@/lib/server/logger';
import { getAudiobookObjectBuffer, listAudiobookObjects } from './blobstore';
import { getDocumentBlob } from '@/lib/server/documents/blobstore';
import { fetchGeminiWithRateLimitFallback, GEMINI_MODEL_FALLBACKS } from '@/lib/server/smart-audio/gemini-failover';
import { readSmartAudioProfilesDocument } from '@/lib/server/smart-audio-profiles';

export interface InferredDocumentMetadata {
  title: string;
  author: string;
  series: string | null;
  seriesIndex: string | null;
  subtitle: string | null;
}

export interface InferMetadataOptions {
  bookId: string;
  userId: string;
  namespace?: string | null;
}

/**
 * Infer clean Title, Author, Series, and Subtitle from document info and sample text
 * using Google Gemini (via Admin Gemini API key or user profile key).
 */
export async function inferDocumentMetadataWithGemini(
  options: InferMetadataOptions,
): Promise<InferredDocumentMetadata> {
  const { bookId, userId, namespace = null } = options;

  // 1. Fetch DB records
  const bookRows = await db
    .select()
    .from(audiobooks)
    .where(and(eq(audiobooks.id, bookId), eq(audiobooks.userId, userId)));
  const book = bookRows[0];

  const docRows = await db
    .select()
    .from(documents)
    .where(and(eq(documents.id, bookId), eq(documents.userId, userId)));
  const doc = docRows[0] || null;

  if (!book && !doc) {
    throw new Error('Book or document record not found.');
  }

  // 2. Resolve sample text from audiobook text chunks or document blob
  let sampleText = '';
  try {
    const objects = await listAudiobookObjects(bookId, userId, namespace);
    const textFiles = objects
      .map((o) => o.fileName)
      .filter((name) => /^\d{4}__text\.txt$/u.test(name))
      .sort();

    if (textFiles.length > 0) {
      // Sample up to first 2 text files (~4,000 characters)
      for (const textFile of textFiles.slice(0, 2)) {
        const buf = await getAudiobookObjectBuffer(bookId, userId, textFile, namespace);
        sampleText += (sampleText ? '\n\n' : '') + buf.toString('utf8');
        if (sampleText.length >= 4000) break;
      }
    }
  } catch {
    // Non-fatal; will try document blob next
  }

  if (!sampleText && doc) {
    try {
      const docBuffer = await getDocumentBlob(doc.id, namespace);
      if (doc.type === 'txt' || doc.type === 'html') {
        sampleText = docBuffer.toString('utf8').replace(/<[^>]+>/g, ' ').slice(0, 4000);
      } else {
        // For PDF/EPUB, grab the first 3000 printable characters
        const raw = docBuffer.toString('utf8', 0, Math.min(docBuffer.length, 30000));
        const printable = raw.replace(/[^\x20-\x7E\n\r\t]/g, ' ').replace(/\s+/g, ' ').trim();
        sampleText = printable.slice(0, 4000);
      }
    } catch {
      // Non-fatal; Gemini will use filename and existing title
    }
  }

  // 3. Resolve Gemini API Key
  const runtime = await getRuntimeConfig();
  let primaryKey = (runtime.geminiApiKey || process.env.GEMINI_API_KEY || '').trim();
  let backupKey = (process.env.BACKUP_GEMINI_API_KEY || '').trim();

  // Fallback to user Smart Audio profiles if Admin key not configured
  if (!primaryKey) {
    try {
      const profilesDoc = await readSmartAudioProfilesDocument(userId);
      for (const p of profilesDoc.profiles) {
        if (p.geminiApiKey?.trim()) {
          primaryKey = p.geminiApiKey.trim();
          if (p.backupGeminiApiKey?.trim()) {
            backupKey = p.backupGeminiApiKey.trim();
          }
          break;
        }
      }
    } catch {
      // ignore profile read errors
    }
  }

  if (!primaryKey) {
    throw new Error(
      'No Gemini API key is configured. Please enter an Admin Gemini API Key in Admin Settings or set GEMINI_API_KEY.',
    );
  }

  // 4. Construct Prompt
  const fallbackTitle = (doc?.name || book?.title || 'Unknown Document')
    .replace(/\.[a-zA-Z0-9]+$/, '')
    .replace(/[_-]+/g, ' ')
    .trim();

  const userPrompt = [
    'Analyze this book/document information and initial text excerpt to determine the clean, canonical catalog metadata for Audiobookshelf.',
    '',
    `Source Filename: "${doc?.name || book?.title || ''}"`,
    `Current Database Title: "${book?.title || ''}"`,
    `Current Database Author: "${book?.author || ''}"`,
    '',
    'Beginning Text Excerpt:',
    '"""',
    sampleText ? sampleText.slice(0, 3500) : '(No text excerpt available - infer from filename and current title)',
    '"""',
    '',
    'Rules:',
    '1. "title": The official book title. Strip file extensions (.pdf, .epub, .txt), UUIDs, random hash suffixes, underscore formatting, release group tags, and chapter numbers.',
    '2. "author": The author or creator name. If unknown or not found, use "Unknown Author".',
    '3. "series": The name of the series this book belongs to, or null if standalone or unknown.',
    '4. "seriesIndex": The volume/number in the series (e.g. "1", "2.5"), or null.',
    '5. "subtitle": The official subtitle if present, or null.',
    '',
    'Respond ONLY with a JSON object matching this schema:',
    '{',
    '  "title": "string",',
    '  "author": "string",',
    '  "series": "string | null",',
    '  "seriesIndex": "string | null",',
    '  "subtitle": "string | null"',
    '}',
  ].join('\n');

  const requestedModel = 'gemini-3.8-flash';
  const fallbackModels = GEMINI_MODEL_FALLBACKS[requestedModel] || ['gemini-3.7-flash', 'gemini-3.6-flash'];

  serverLogger.info(
    {
      event: 'audiobook.metadata.inference.start',
      bookId,
      filename: doc?.name,
      model: requestedModel,
    },
    'Starting Gemini book metadata inference',
  );

  const { response } = await fetchGeminiWithRateLimitFallback({
    primaryApiKey: primaryKey,
    backupApiKey: backupKey || undefined,
    requestedModel,
    fallbackModels,
    request: (apiKey, model) =>
      fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model || requestedModel)}:generateContent?key=${encodeURIComponent(apiKey)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
            systemInstruction: {
              parts: [
                {
                  text: 'You are an expert digital librarian and cataloger. Return only valid JSON with clean, accurate title, author, and series metadata.',
                },
              ],
            },
            generationConfig: {
              responseMimeType: 'application/json',
              temperature: 0.1,
            },
          }),
        },
      ),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    serverLogger.error(
      {
        event: 'audiobook.metadata.inference.failed',
        status: response.status,
        error: errText,
      },
      'Gemini metadata inference request failed',
    );
    throw new Error(`Gemini metadata inference failed (${response.status}): ${errText || response.statusText}`);
  }

  const responseJson = (await response.json()) as {
    candidates?: Array<{
      content?: {
        parts?: Array<{ text?: string }>;
      };
    }>;
  };

  const rawText = responseJson.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '{}';
  // Strip possible markdown json wrapping ```json ... ```
  const cleanedJson = rawText.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();

  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(cleanedJson);
  } catch (parseError) {
    serverLogger.warn(
      { event: 'audiobook.metadata.inference.parse_error', rawText, error: errorToLog(parseError) },
      'Failed to parse Gemini metadata JSON, falling back to heuristics',
    );
  }

  const title = (typeof parsed.title === 'string' && parsed.title.trim())
    ? parsed.title.trim()
    : fallbackTitle;
  const author = (typeof parsed.author === 'string' && parsed.author.trim())
    ? parsed.author.trim()
    : (book?.author || 'Unknown Author');
  const series = (typeof parsed.series === 'string' && parsed.series.trim())
    ? parsed.series.trim()
    : null;
  const seriesIndex = (typeof parsed.seriesIndex === 'string' && parsed.seriesIndex.trim())
    ? parsed.seriesIndex.trim()
    : null;
  const subtitle = (typeof parsed.subtitle === 'string' && parsed.subtitle.trim())
    ? parsed.subtitle.trim()
    : null;

  serverLogger.info(
    {
      event: 'audiobook.metadata.inference.success',
      bookId,
      title,
      author,
      series,
      seriesIndex,
    },
    'Successfully inferred book metadata with Gemini',
  );

  return {
    title,
    author,
    series,
    seriesIndex,
    subtitle,
  };
}
