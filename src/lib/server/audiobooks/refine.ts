import { db } from '@/db';
import { audiobookJobs, documents } from '@/db/schema';
import { eq, and } from 'drizzle-orm';
import { serverLogger } from '@/lib/server/logger';
import { listAudiobookObjects, getAudiobookObjectBuffer, putAudiobookObject } from '@/lib/server/audiobooks/blobstore';
import { fetchGeminiWithRateLimitFallback } from '@/lib/server/smart-audio/gemini-failover';
import { findSmartAudioProfileById } from '@/lib/server/smart-audio-profiles';
import { INTERNAL_WORKER_SECRET } from '@/lib/server/internal-secret';

export async function processBatchRefineJob(
  job: typeof audiobookJobs.$inferSelect,
  updateProgress: (progress: number) => Promise<void>,
  markError: (err: string) => Promise<void>
) {
  const bookId = job.documentId;
  const userId = job.userId;
  const jobSettings = typeof job.settingsJson === 'string' ? JSON.parse(job.settingsJson) : (job.settingsJson || {});
  const refineRule = jobSettings.rule;

  if (!refineRule) {
    await markError('Refine rule is missing in job settings');
    return;
  }

  try {
    const docRows = await db.select().from(documents).where(and(eq(documents.id, bookId), eq(documents.userId, userId))).limit(1);
    
    if (docRows.length === 0) {
      await markError('Document not found');
      return;
    }

    // We must import documentSettings here if we want to query it, but wait!
    // We didn't import documentSettings in refine.ts! Let's just require it.
    const { documentSettings } = await import('@/db/schema');
    const settingsRows = await db.select().from(documentSettings).where(eq(documentSettings.documentId, bookId)).limit(1);
    
    const selectedProfileId = (settingsRows[0]?.settingsJson as any)?.audiobookProfileId || 'default';
    const { readSmartAudioProfilesDocument } = await import('@/lib/server/smart-audio-profiles');
    const profilesDoc = await readSmartAudioProfilesDocument(userId);
    const profile = await findSmartAudioProfileById(profilesDoc, selectedProfileId);
    
    // We try to use the primary key, or fallback key, or system key
    const { userPreferences } = await import('@/db/schema');
    const userPrefs = await db.select().from(userPreferences).where(eq(userPreferences.userId, userId)).limit(1);
    const globalKey = userPrefs[0]?.geminiApiKey || process.env.GEMINI_API_KEY || '';
    const globalBackupKey = userPrefs[0]?.backupGeminiApiKey || process.env.BACKUP_GEMINI_API_KEY || '';
    
    const primaryKey = (profile?.geminiApiKey || globalKey).trim();
    const backupKey = (profile?.backupGeminiApiKey || globalBackupKey).trim();
    const resolvedModel = profile?.pronunciationAiModel || 'gemini-2.5-flash';

    serverLogger.info({ event: 'audiobook.batch_refine.start', bookId, jobId: job.id }, 'Starting batch refine job');

    const objects = await listAudiobookObjects(bookId, userId, null);
    // Find all the .txt chapter files
    const txtFiles = objects.filter(o => o.fileName.endsWith('.txt') && !o.fileName.includes('__changelog')).sort((a, b) => a.fileName.localeCompare(b.fileName));

    if (txtFiles.length === 0) {
      await updateProgress(100);
      return;
    }

    const promptTemplate = `You are a surgical text refinement assistant.
Your task is to apply a SINGLE specific cleanup rule to the provided audiobook text.
You MUST NOT change anything else in the text. Preserve all existing formatting, punctuation, and pronunciation tags (like [word](/ipa/)) exactly as they are, EXCEPT where the rule explicitly requires you to modify or delete them. Do not add commentary or conversational filler. Return ONLY the refined text.

RULE TO APPLY:
${refineRule}

TEXT TO REFINE:
`;

    for (let i = 0; i < txtFiles.length; i++) {
      // Check for cancellation
      const currentJobRows = await db.select().from(audiobookJobs).where(eq(audiobookJobs.id, job.id)).limit(1);
      if (currentJobRows.length === 0 || currentJobRows[0].status !== 'running') {
        serverLogger.info({ event: 'audiobook.batch_refine.cancelled', bookId, jobId: job.id }, 'Job was cancelled or stopped, aborting refine loop');
        return; // Abort
      }

      const txtFile = txtFiles[i];
      const buf = await getAudiobookObjectBuffer(bookId, userId, txtFile.fileName, null);
      const originalText = buf.toString('utf-8');

      serverLogger.info({ event: 'audiobook.batch_refine.chapter', bookId, chapter: txtFile.fileName }, `Refining chapter ${txtFile.fileName}`);

      const fullPrompt = promptTemplate + originalText;

      const result = await fetchGeminiWithRateLimitFallback({
        primaryApiKey: primaryKey,
        backupApiKey: backupKey,
        requestedModel: resolvedModel,
        request: (apiKey, requestModel) => fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(requestModel || resolvedModel)}:generateContent?key=${encodeURIComponent(apiKey)}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ role: 'user', parts: [{ text: fullPrompt }] }],
              systemInstruction: { parts: [{ text: "You are a precise text editor. Only apply the user's rule. Do not summarize or alter text outside the rule's scope." }] },
              generationConfig: { temperature: 0.1 },
              safetySettings: [
                { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_NONE' },
                { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_NONE' },
                { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_NONE' },
                { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_NONE' },
              ],
            }),
          }
        ),
      });

      const jsonBody = await result.response.json().catch(() => ({}));
      const textResponse = jsonBody?.candidates?.[0]?.content?.parts?.[0]?.text;

      if (!textResponse) {
        const errorMsg = jsonBody?.error?.message || jsonBody?.candidates?.[0]?.finishReason || JSON.stringify(jsonBody);
        throw new Error(`Gemini returned empty text for chapter ${txtFile.fileName}. Gemini Response: ${errorMsg}`);
      }

      const refinedText = textResponse.trim();

      // Only overwrite the blob (and thus trigger an audio re-record) if Gemini ACTUALLY changed something!
      if (refinedText !== originalText.trim()) {
        serverLogger.info({ event: 'audiobook.batch_refine.chapter_changed', bookId, chapter: txtFile.fileName }, `Chapter ${txtFile.fileName} was modified by the rule.`);
        await putAudiobookObject(bookId, userId, txtFile.fileName, Buffer.from(refinedText, 'utf-8'), 'text/plain', null);
      } else {
        serverLogger.info({ event: 'audiobook.batch_refine.chapter_unchanged', bookId, chapter: txtFile.fileName }, `Chapter ${txtFile.fileName} was unchanged.`);
      }

      await updateProgress(Math.floor(((i + 1) / txtFiles.length) * 100));
    }

    serverLogger.info({ event: 'audiobook.batch_refine.complete', bookId, jobId: job.id }, 'Completed batch refine job');
    
    // Now that the text is refined, we need to trigger an audio rebuild.
    // We can do this by just calling the Next.js API route directly to queue a batch-regenerate
    const baseUrl = `http://127.0.0.1:${process.env.PORT || 3003}`;
    await fetch(`${baseUrl}/api/audiobooks/batch-regenerate`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'x-internal-secret': INTERNAL_WORKER_SECRET
      },
      body: JSON.stringify({ bookId: bookId, forceAll: false, userId: userId })
    }).catch(e => {
        serverLogger.warn({ event: 'audiobook.batch_refine.trigger_audio_error', error: String(e) }, 'Failed to trigger batch audio regeneration');
    });

  } catch (err: any) {
    serverLogger.error({ event: 'audiobook.batch_refine.error', error: err.stack }, 'Error in batch refine job');
    throw err;
  }
}
