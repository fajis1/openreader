
import { readSmartAudioProfilesDocument, findSmartAudioProfileById, writeSmartAudioProfilesDocument } from '@/lib/server/smart-audio-profiles';
import { eq, and, asc, lt, inArray } from 'drizzle-orm';
import { db } from '@/db';
import { audiobookJobs, documents, audiobooks, audiobookChapters } from '@/db/schema';
import { readCurrentParsedPdfArtifact } from '@/lib/server/pdf-parse/artifact';
import { getDocumentBlob } from '@/lib/server/documents/blobstore';
import { checkSystemResources } from '@/lib/server/audiobooks/system-monitor';
import { randomUUID } from 'node:crypto';
import { generateTTSBuffer } from '@/lib/server/tts/generate';
import { resolveTtsCredentials } from '@/lib/server/admin/resolve-credentials';
import { getResolvedRuntimeConfig } from '@/lib/server/runtime-config';
import { putAudiobookObject } from '@/lib/server/audiobooks/blobstore';
import { encodeChapterFileName } from '@/lib/server/audiobooks/chapters';
import { createOrReuseCurrentPdfParseOperation } from '@/lib/server/pdf-parse/operation';
import JSZip from 'jszip';
import type { ParsedPdfDocument } from '@/types/parsed-pdf';
import { normalizeTextForTts } from '@/lib/shared/nlp';
import { serverLogger } from '@/lib/server/logger';
import { INTERNAL_WORKER_SECRET } from '@/lib/server/internal-secret';

function stripHtmlTags(html: string): string {
  return html.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
             .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
             .replace(/<[^>]+>/g, ' ')
             .replace(/\s+/g, ' ')
             .trim();
}

async function extractTextFromEpub(buffer: Buffer): Promise<{ title: string; text: string }[]> {
  const zip = await JSZip.loadAsync(buffer);
  const containerXml = await zip.file('META-INF/container.xml')?.async('string');
  if (!containerXml) throw new Error('Missing container.xml');
  
  const opfPathMatch = containerXml.match(/full-path="([^"]+)"/);
  if (!opfPathMatch) throw new Error('Missing OPF path');
  const opfPath = opfPathMatch[1];
  
  const opfContent = await zip.file(opfPath)?.async('string');
  if (!opfContent) throw new Error('Missing OPF file');
  
  const basePath = opfPath.includes('/') ? opfPath.substring(0, opfPath.lastIndexOf('/') + 1) : '';
  
  const manifest: Record<string, string> = {};
  for (const match of opfContent.matchAll(/<item\s+([^>]+)>/gi)) {
    const attrs = match[1];
    const idMatch = attrs.match(/id="([^"]+)"/i);
    const hrefMatch = attrs.match(/href="([^"]+)"/i);
    if (idMatch && hrefMatch) {
      manifest[idMatch[1]] = hrefMatch[1];
    }
  }
  
  const spine: string[] = [];
  for (const match of opfContent.matchAll(/<itemref\s+([^>]+)>/gi)) {
    const idrefMatch = match[1].match(/idref="([^"]+)"/i);
    if (idrefMatch) {
      spine.push(idrefMatch[1]);
    }
  }
  
  const chapters: { title: string; text: string }[] = [];
  for (let i = 0; i < spine.length; i++) {
    const idref = spine[i];
    const href = manifest[idref];
    if (!href) continue;
    const file = zip.file(basePath + href);
    if (!file) continue;
    
    const htmlContent = await file.async('string');
    const text = stripHtmlTags(htmlContent);
    if (text.trim().length > 0) {
      chapters.push({
        title: `Chapter ${chapters.length + 1}`,
        text: text,
      });
    }
  }
  return chapters;
}

const globalWorkerState = globalThis as unknown as { __worker_booted?: boolean };

export async function processAudiobookQueue() {
  if (!globalWorkerState.__worker_booted) {
    globalWorkerState.__worker_booted = true;
    serverLogger.info({ event: 'audiobook.queue.boot' }, 'Worker booted. Resetting any orphaned running jobs to queued.');
    await db.update(audiobookJobs)
      .set({ status: 'queued', progress: 0 })
      .where(eq(audiobookJobs.status, 'running'));
  } else {
    // Reset any jobs that have been "running" for over 15 minutes without an update (stale crash recovery)
    const staleThreshold = Date.now() - 15 * 60 * 1000;
    await db.update(audiobookJobs)
      .set({ status: 'queued', progress: 0 })
      .where(and(eq(audiobookJobs.status, 'running'), lt(audiobookJobs.updatedAt, staleThreshold)));
  }

  const resources = await checkSystemResources();
  if (!resources.ok) {
    serverLogger.warn({ event: 'audiobook.queue.degraded', reason: resources.reason }, `System resources degraded: ${resources.reason}`);
    return;
  }

  const MAX_CONCURRENT_JOBS = 3;

  const rows = await db.select()
    .from(audiobookJobs)
    .where(inArray(audiobookJobs.status, ['queued', 'waiting_for_pdf']))
    .orderBy(asc(audiobookJobs.createdAt))
    .limit(MAX_CONCURRENT_JOBS);
  
  if (rows.length === 0) return;
  
  const jobIds = rows.map((r: typeof rows[0]) => r.id);
  const updateResult = await db.update(audiobookJobs)
    .set({ status: 'running', startedAt: Date.now() })
    .where(and(inArray(audiobookJobs.id, jobIds), inArray(audiobookJobs.status, ['queued', 'waiting_for_pdf'])))
    .returning();
    
  if (updateResult.length === 0) return;
  
  await Promise.allSettled(updateResult.map((job: typeof updateResult[0]) => processSingleAudiobookJob(job)));
}

async function processSingleAudiobookJob(job: typeof audiobookJobs.$inferSelect) {
  const updateProgress = async (progress: number) => {
    await db.update(audiobookJobs).set({ progress, updatedAt: Date.now() }).where(eq(audiobookJobs.id, job.id));
  };

  const markError = async (err: string) => {
    await db.update(audiobookJobs).set({ status: 'error', error: err, completedAt: Date.now() }).where(eq(audiobookJobs.id, job.id));
  };

  try {
    serverLogger.info({ event: 'audiobook.queue.start', jobId: job.id, documentId: job.documentId }, `Starting background audiobook generation job ${job.id}`);
    const docRows = await db.select().from(documents).where(eq(documents.id, job.documentId));
    if (docRows.length === 0) throw new Error('Document not found');
    const doc = docRows[0];

    const bookId = doc.id;
    const userId = job.userId;

    const existingBook = await db.select().from(audiobooks).where(and(eq(audiobooks.id, bookId), eq(audiobooks.userId, userId)));
    const jobSettings = typeof job.settingsJson === 'string' ? JSON.parse(job.settingsJson) : (job.settingsJson || {});
    const hasSmartAudio = !!jobSettings?.useSmartAudio;
    const testNamespace = jobSettings?.testNamespace || null;

    if (existingBook.length === 0) {
      await db.insert(audiobooks).values({
        id: bookId,
        userId: userId,
        title: doc.name,
        hasSmartAudio,
      });
    } else if (hasSmartAudio && !existingBook[0].hasSmartAudio) {
      // Upgrade existing audiobook to show it has smart audio changelog
      await db.update(audiobooks).set({ hasSmartAudio: true }).where(eq(audiobooks.id, bookId));
    }

    let chapters: { index: number; title: string; text: string }[] = [];

    if (doc.type === 'pdf') {
      let artifact = await readCurrentParsedPdfArtifact({ documentId: doc.id, namespace: testNamespace });
      if (!artifact) {
        await createOrReuseCurrentPdfParseOperation({ documentId: doc.id, namespace: testNamespace });
        await db.update(audiobookJobs).set({ status: 'waiting_for_pdf' }).where(eq(audiobookJobs.id, job.id));
        
        // Wait up to 15 seconds for the PDF artifact (e.g. for compute-core to finish parsing it in the background)
        let found = false;
        for (let i = 0; i < 15; i++) {
          await new Promise(r => setTimeout(r, 1000));
          artifact = await readCurrentParsedPdfArtifact({ documentId: doc.id, namespace: testNamespace });
          if (artifact) {
            found = true;
            await db.update(audiobookJobs).set({ status: 'running' }).where(eq(audiobookJobs.id, job.id));
            break;
          }
        }
        
        if (!found) {
          return;
        }
      }
      const parsedPdf = JSON.parse(artifact.bytes.toString('utf-8')) as ParsedPdfDocument;
      
      const allBlocks = parsedPdf.pages.flatMap(p => p.blocks);
      const chapterBoundaryKinds = new Set(['paragraph_title', 'doc_title']);
      
      let currentTitle = 'Introduction';
      let currentText: string[] = [];
      let currentLength = 0;
      let lastBlockWasTitle = false;
      
      const flush = () => {
        const text = currentText.join('\n\n').trim();
        if (text) {
          chapters.push({ index: chapters.length, title: currentTitle, text });
        }
        currentText = [];
        currentLength = 0;
        lastBlockWasTitle = false;
      };

      for (const block of allBlocks) {
        const blockText = block.text.trim();
        if (!blockText) continue;

        if (chapterBoundaryKinds.has(block.kind)) {
          if (currentLength >= 4000) {
            flush();
            currentTitle = blockText || `Chapter ${chapters.length + 1}`;
          } else if (currentText.length === 0) {
            currentTitle = blockText || `Chapter ${chapters.length + 1}`;
          }
          currentText.push(blockText);
          currentLength += blockText.length + 2;
          lastBlockWasTitle = true;
        } else {
          const lastIndex = currentText.length - 1;
          const isContinuation = !lastBlockWasTitle && lastIndex >= 0 && !/[.!?…'"”’\]}):;]\s*$/.test(currentText[lastIndex]);

          // Only flush if we are safely AT a paragraph boundary!
          if (!isContinuation && currentLength >= 4000) {
            flush();
            currentTitle = currentTitle.endsWith('(Continued)') ? currentTitle : `${currentTitle} (Continued)`;
          }

          if (isContinuation && lastIndex >= 0) {
            currentText[lastIndex] += ' ' + blockText;
            currentLength += blockText.length + 1;
          } else {
            currentText.push(blockText);
            currentLength += blockText.length + 2;
          }
          lastBlockWasTitle = false;
        }
      }
      flush();

    } else if (doc.type === 'epub') {
      const buffer = await getDocumentBlob(doc.id, testNamespace);
      const epubChapters = await extractTextFromEpub(buffer);
      chapters = epubChapters.map((c, i) => ({ index: i, title: c.title, text: c.text }));
    } else if (doc.type === 'txt' || doc.type === 'html') {
      const buffer = await getDocumentBlob(doc.id, testNamespace);
      let text = buffer.toString('utf-8');
      if (doc.type === 'html') text = stripHtmlTags(text);
      chapters = [{ index: 0, title: 'Document', text }];
    } else {
      throw new Error(`Unsupported document type: ${doc.type}`);
    }

    if (chapters.length === 0) throw new Error('No content found');

    const runtimeConfig = await getResolvedRuntimeConfig();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const settings = (job.settingsJson as Record<string, any>) || {};
    const format = (settings.format as 'mp3' | 'm4b') || 'm4b';

    const creds = await resolveTtsCredentials({
      providerHeader: settings.providerRef || null,
      apiKeyHeader: null,
      baseUrlHeader: null,
      fallbackProvider: runtimeConfig.defaultTtsProvider,
      restrictUserApiKeys: true,
    });

    if ('error' in creds) {
      throw new Error(`Failed to resolve TTS credentials: ${creds.error}. Background generation requires admin TTS providers.`);
    }

    let processedLength = 0;
    let totalBytes = 0;
    const totalLength = chapters.reduce((sum, c) => sum + c.text.length, 0);

    const useSmartAudio = Boolean(settings.useSmartAudio);

    let nc: import("nats").NatsConnection | null = null;
    let sc: import("nats").Codec<string> | null = null;
    if (useSmartAudio) {
      try {
        const { connect, StringCodec } = await import('nats');
        serverLogger.info({ event: 'audiobook.queue.smart_audio.init', bookId }, 'Connecting to NATS for Gemini worker...');
        nc = await connect({ servers: "nats://127.0.0.1:4222", maxReconnectAttempts: 1, timeout: 2000 });
        sc = StringCodec();
      } catch (e) {
        serverLogger.warn({ event: 'audiobook.queue.smart_audio.error', error: e }, 'Failed to connect to NATS, smart audio will fail');
      }
    }

    for (const chapter of chapters) {
      // ABORT CHECK: If user cancelled/deleted the job from the UI, abort processing
      const currentJobCheck = await db.select({ id: audiobookJobs.id, status: audiobookJobs.status }).from(audiobookJobs).where(eq(audiobookJobs.id, job.id));
      if (currentJobCheck.length === 0 || currentJobCheck[0].status !== 'running') {
        serverLogger.info({ event: 'audiobook.queue.aborted', jobId: job.id }, 'Job was cancelled or deleted by user. Aborting worker loop.');
        if (nc) await nc.close();
        return;
      }

      if (!chapter.text.trim()) continue;

      // END OF BOOK TRIPWIRE: Save API tokens by aborting when we hit a bibliography
      const progressRatio = processedLength / totalLength;
      if (progressRatio > 0.85) {
        const titleLower = chapter.title.toLowerCase();
        if (titleLower.includes('bibliography') || titleLower.includes('works cited') || titleLower.includes('references') || titleLower === 'index') {
          serverLogger.info({ event: 'audiobook.queue.tripwire', title: chapter.title }, 'Bibliography tripwire triggered. Skipping the rest of the book to save API tokens.');
          break; // Break the loop, which triggers the 'completed' database update at the bottom!
        }
      }

      const chapterFileName = encodeChapterFileName(chapter.index, chapter.title, format);
      
      // CRASH RECOVERY: Check if chapter already exists in DB
      const existing = await db.select().from(audiobookChapters).where(and(eq(audiobookChapters.bookId, bookId), eq(audiobookChapters.chapterIndex, chapter.index)));
      if (existing.length > 0) {
        processedLength += chapter.text.length;
        await updateProgress(Math.floor((processedLength / totalLength) * 100));
        continue;
      }

      let processedTextForTts = chapter.text;
      

      if (useSmartAudio && nc && sc) {
        const smartAudioProfileId = String(settings.smartAudioProfileId || '');
        const profilesDocument = await readSmartAudioProfilesDocument(userId);
        const selectedProfile = findSmartAudioProfileById(profilesDocument, smartAudioProfileId);
        
        try {
          serverLogger.info({ event: 'audiobook.queue.smart_audio.enabled', bookId, chapter: chapter.index }, 'Triggering Python Gemini worker...');
          
          // Key is stored per-profile; fall back to empty string which causes
          // the Python worker to return {status:"error"} and skip smart audio.
          const geminiApiKey = (selectedProfile?.geminiApiKey || '').trim();

          const payload = JSON.stringify({
            user_id: userId,
            api_key: geminiApiKey,
            ai_model: selectedProfile?.aiModel || 'gemini-2.5-flash',
            prompt: selectedProfile?.customTtsPrompt || "You are an expert audiobook preparation assistant...",
            raw_text: chapter.text,
            pronunciations: selectedProfile?.pronunciations || {}, 
            abbreviations: selectedProfile?.abbreviations || {},
            books: selectedProfile?.books || {}
          });

          const msg = await nc.request("audiobooks.gemini.clean", sc.encode(payload), { timeout: 120000 });
          const workerResult = JSON.parse(sc.decode(msg.data));

          if (workerResult.status === "rate_limit") {
            serverLogger.warn({ event: 'audiobook.queue.smart_audio.rate_limit', bookId }, 'Python worker reported rate limit. Moving job to back of queue.');
            if (nc) await nc.close();
            await db.update(audiobookJobs)
              .set({ status: 'queued', createdAt: Date.now() })
              .where(eq(audiobookJobs.id, job.id));
            return;
          }

          if (workerResult.status === "success" && workerResult.cleaned_text) {
            processedTextForTts = workerResult.cleaned_text;
            
            // Save newly discovered pronunciations back to the profile!
            if (workerResult.new_pronunciations && Object.keys(workerResult.new_pronunciations).length > 0 && selectedProfile) {
              try {
                // Must read fresh just in case it was updated during generation
                const updatedDoc = await readSmartAudioProfilesDocument(userId);
                const profileToUpdate = updatedDoc.profiles.find(p => p.id === selectedProfile.id);
                if (profileToUpdate) {
                  profileToUpdate.pronunciations = { ...profileToUpdate.pronunciations, ...workerResult.new_pronunciations };
                  await writeSmartAudioProfilesDocument(userId, updatedDoc);
                  serverLogger.info({ event: 'audiobook.queue.smart_audio.learned_pronunciations', count: Object.keys(workerResult.new_pronunciations).length }, 'Saved new learned pronunciations to smart audio profile');
                }
              } catch (saveErr) {
                serverLogger.warn({ event: 'audiobook.queue.smart_audio.learned_pronunciations_failed', error: saveErr }, 'Failed to save learned pronunciations');
              }
            }
            
            if (workerResult.changelog) {
              const changelogName = `${String(chapter.index + 1).padStart(4, '0')}__changelog.txt`;
              await putAudiobookObject(bookId, userId, changelogName, Buffer.from(workerResult.changelog, 'utf8'), 'text/plain; charset=utf-8', testNamespace).catch(() => {});
            }
          } else if (workerResult.status === "error") {
            throw new Error(`Python worker returned error: ${workerResult.message}`);
          }
        } catch (e) {
          serverLogger.error({ event: 'audiobook.queue.smart_audio.failed', error: e }, 'Smart audio processing failed. Aborting generation.');
          if (nc) await nc.close();
          
          const jobSettingsParsed = typeof job.settingsJson === 'string' ? JSON.parse(job.settingsJson) : (job.settingsJson || {});
          const retries = typeof jobSettingsParsed.smartAudioRetries === 'number' ? jobSettingsParsed.smartAudioRetries : 0;
          
          if (retries < 1) {
            jobSettingsParsed.smartAudioRetries = retries + 1;
            serverLogger.info({ event: 'audiobook.queue.smart_audio.retry_scheduled' }, 'Scheduling auto-retry in 5 minutes...');
            
            await db.update(audiobookJobs).set({ 
              settingsJson: JSON.stringify(jobSettingsParsed), 
              status: 'error', 
              error: 'Smart audio failed to connect. Will automatically retry in 5 minutes...' 
            }).where(eq(audiobookJobs.id, job.id));
            
            setTimeout(async () => {
              try {
                // If it's still in error state (user hasn't manually cancelled or requeued it)
                const currentJobCheck = await db.select({ status: audiobookJobs.status }).from(audiobookJobs).where(eq(audiobookJobs.id, job.id));
                if (currentJobCheck.length > 0 && currentJobCheck[0].status === 'error') {
                  serverLogger.info({ event: 'audiobook.queue.smart_audio.auto_requeue' }, 'Auto-requeuing delayed smart audio job...');
                  await db.update(audiobookJobs).set({ status: 'queued', error: null, progress: 0 }).where(eq(audiobookJobs.id, job.id));
                }
              } catch (retryErr) {
                serverLogger.error({ event: 'audiobook.queue.smart_audio.auto_requeue.error', error: retryErr }, 'Failed to auto-requeue job');
              }
            }, 5 * 60 * 1000);
            
            return;
          }
          
          throw new Error('Smart audio processing failed after auto-retry (Python worker unreachable). Job aborted so it can be requeued later.');
        }
      }

      const normalized = normalizeTextForTts(processedTextForTts, { maxBlockLength: 4000 });
      
      const ttsBuffer = await generateTTSBuffer({
        text: normalized,
        voice: settings.voice || 'alloy',
        speed: settings.speed || 1,
        format: 'mp3',
        provider: creds.provider,
        apiKey: creds.apiKey,
        baseUrl: creds.baseUrl,
        testNamespace: testNamespace,
      });

      const contentType = format === 'mp3' ? 'audio/mpeg' : 'audio/mp4';
      totalBytes += ttsBuffer.length;
      await putAudiobookObject(bookId, userId, chapterFileName, ttsBuffer, contentType, testNamespace);

      try {
        await db.insert(audiobookChapters).values({
          id: randomUUID(),
          bookId,
          userId,
          chapterIndex: chapter.index,
          title: chapter.title,
          duration: 0,
          filePath: chapterFileName,
          format,
        });
      } catch (insertErr: unknown) {
        if (insertErr instanceof Error && insertErr.message.includes('FOREIGN KEY')) {
          serverLogger.info({ event: 'audiobook.queue.aborted', jobId: job.id }, 'Audiobook deleted during chapter generation, aborting.');
          if (nc) await nc.close();
          await db.delete(audiobookJobs).where(eq(audiobookJobs.id, job.id)).catch(() => {});
          return;
        }
        throw insertErr;
      }

      processedLength += chapter.text.length;
      await updateProgress(Math.floor((processedLength / totalLength) * 100));
    }

    if (nc) await nc.close();

    await db.update(audiobookJobs).set({ status: 'completed', completedAt: Date.now(), progress: 100 }).where(eq(audiobookJobs.id, job.id));
    await db.update(audiobooks).set({ totalBytes }).where(and(eq(audiobooks.id, bookId), eq(audiobooks.userId, userId)));
    serverLogger.info({ event: 'audiobook.queue.complete', jobId: job.id, documentId: job.documentId }, `Successfully completed audiobook job ${job.id}`);

    // Fire-and-forget internal request to pre-compile the .m4b so the user doesn't have to wait
    const baseUrl = process.env.BASE_URL || `http://127.0.0.1:${process.env.PORT || 3003}`;
    fetch(`${baseUrl}/api/audiobook?bookId=${bookId}&format=m4b&userId=${userId}`, {
      headers: { 'x-internal-secret': INTERNAL_WORKER_SECRET }
    }).catch((e) => {
      serverLogger.warn({ event: 'audiobook.queue.precompile.error', error: String(e) }, 'Failed to trigger background m4b compilation');
    });

  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    
    // Auto-requeue transient connectivity crashes (like server reloads or NATS timeouts)
    if (errorMsg.includes('terminated') || errorMsg.includes('fetch failed') || errorMsg.includes('timeout')) {
      serverLogger.warn({ event: 'audiobook.queue.process.requeue', error: errorMsg }, 'Transient error detected, moving job to back of queue.');
      await db.update(audiobookJobs).set({ status: 'queued', createdAt: Date.now() }).where(eq(audiobookJobs.id, job.id));
      return;
    }
    
    serverLogger.error({ event: 'audiobook.queue.process.error', error: err instanceof Error ? err.stack : String(err) }, 'Error processing audiobook queue');
    await markError(errorMsg);
  }
}
