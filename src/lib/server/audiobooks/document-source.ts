import crypto from 'node:crypto';

import JSZip from 'jszip';

import { getDocumentBlob } from '@/lib/server/documents/blobstore';
import { readCurrentParsedPdfArtifact } from '@/lib/server/pdf-parse/artifact';
import { createOrReuseCurrentPdfParseOperation } from '@/lib/server/pdf-parse/operation';
import { computeTocBoundaries, extractPdfToc } from '@/lib/server/pdf-parse/toc';
import { preparePdfAudiobookBlocks } from '@/lib/shared/pdf-audiobook-blocks';
import { CURRENT_AUDIOBOOK_BATCH_VERSION } from '@/lib/shared/audiobook-batching';
import { extractEpubChapterHeading } from '@/lib/shared/audiobook-end-matter';
import type { DocumentSettings } from '@/types/document-settings';
import type { ParsedPdfDocument } from '@/types/parsed-pdf';

export type AudiobookSourceChapter = {
  title: string;
  text: string;
};

export class PdfCharacterSourcePendingError extends Error {
  readonly operationId: string | null;

  constructor(operationId: string | null) {
    super('PDF layout analysis is still running. Character scanning will resume when it is ready.');
    this.name = 'PdfCharacterSourcePendingError';
    this.operationId = operationId;
  }
}

export function stripAudiobookHtml(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/giu, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/giu, '')
    .replace(/<[^>]+>/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

export async function extractAudiobookTextFromEpub(buffer: Buffer): Promise<AudiobookSourceChapter[]> {
  const zip = await JSZip.loadAsync(buffer);
  const containerXml = await zip.file('META-INF/container.xml')?.async('string');
  if (!containerXml) throw new Error('Missing container.xml');
  const opfPath = containerXml.match(/full-path="([^"]+)"/iu)?.[1];
  if (!opfPath) throw new Error('Missing OPF path');
  const opfContent = await zip.file(opfPath)?.async('string');
  if (!opfContent) throw new Error('Missing OPF file');
  const basePath = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';

  const manifest: Record<string, string> = {};
  for (const match of opfContent.matchAll(/<item\s+([^>]+)>/giu)) {
    const id = match[1].match(/id="([^"]+)"/iu)?.[1];
    const href = match[1].match(/href="([^"]+)"/iu)?.[1];
    if (id && href) manifest[id] = href;
  }
  const spine = [...opfContent.matchAll(/<itemref\s+([^>]+)>/giu)]
    .map((match) => match[1].match(/idref="([^"]+)"/iu)?.[1])
    .filter((id): id is string => Boolean(id));

  const chapters: AudiobookSourceChapter[] = [];
  for (const id of spine) {
    const href = manifest[id];
    if (!href) continue;
    const file = zip.file(basePath + href);
    if (!file) continue;
    const html = await file.async('string');
    const text = stripAudiobookHtml(html);
    if (!text) continue;
    chapters.push({
      title: extractEpubChapterHeading(html) || `Chapter ${chapters.length + 1}`,
      text,
    });
  }
  return chapters;
}

async function loadPdfSource(input: {
  documentId: string;
  pages: number | null;
  namespace: string | null;
  settings: DocumentSettings;
}): Promise<AudiobookSourceChapter[]> {
  const artifact = await readCurrentParsedPdfArtifact({
    documentId: input.documentId,
    namespace: input.namespace,
  });
  if (!artifact) {
    const operation = await createOrReuseCurrentPdfParseOperation({
      documentId: input.documentId,
      namespace: input.namespace,
    });
    if (operation.status === 'failed') {
      throw new Error(operation.error?.message || 'PDF layout analysis failed.');
    }
    throw new PdfCharacterSourcePendingError(operation.opId || null);
  }

  const parsed = JSON.parse(artifact.bytes.toString('utf8')) as ParsedPdfDocument;
  const sourceBytes = await getDocumentBlob(input.documentId, input.namespace);
  const toc = await extractPdfToc(sourceBytes);
  const boundaries = computeTocBoundaries(toc, input.pages || parsed.pages.length || 9_999);
  const prepared = preparePdfAudiobookBlocks({
    parsed,
    settings: input.settings,
    cleanupBatchVersion: CURRENT_AUDIOBOOK_BATCH_VERSION,
  });
  const byPage = new Map<number, string[]>();
  for (const block of prepared.blocks) {
    if (block.pageNumber < boundaries.startPage || block.pageNumber > boundaries.endPage) continue;
    const text = block.text.trim();
    if (!text) continue;
    const page = byPage.get(block.pageNumber) || [];
    page.push(text);
    byPage.set(block.pageNumber, page);
  }
  return [...byPage.entries()]
    .sort(([left], [right]) => left - right)
    .map(([pageNumber, blocks]) => ({
      title: `Page ${pageNumber}`,
      text: blocks.join('\n\n'),
    }))
    .filter((chapter) => Boolean(chapter.text));
}

export async function loadCanonicalAudiobookSource(input: {
  document: { id: string; type: string; pages?: number | null };
  namespace: string | null;
  settings: DocumentSettings;
}): Promise<AudiobookSourceChapter[]> {
  if (input.document.type === 'pdf') {
    return loadPdfSource({
      documentId: input.document.id,
      pages: input.document.pages ?? null,
      namespace: input.namespace,
      settings: input.settings,
    });
  }
  const buffer = await getDocumentBlob(input.document.id, input.namespace);
  if (input.document.type === 'epub') return extractAudiobookTextFromEpub(buffer);
  if (input.document.type === 'html') {
    return [{ title: 'Document', text: stripAudiobookHtml(buffer.toString('utf8')) }];
  }
  if (input.document.type === 'txt') {
    return [{ title: 'Document', text: buffer.toString('utf8').trim() }];
  }
  throw new Error(`Unsupported document type: ${input.document.type}`);
}

function excerpt(text: string, budget: number): string {
  if (text.length <= budget) return text;
  if (budget < 300) return text.slice(0, budget);
  const part = Math.floor(budget / 3);
  const middleStart = Math.max(0, Math.floor(text.length / 2) - Math.floor(part / 2));
  return [
    text.slice(0, part),
    text.slice(middleStart, middleStart + part),
    text.slice(-part),
  ].join('\n[…]\n').slice(0, budget);
}

export function buildCharacterScanSource(
  chapters: readonly AudiobookSourceChapter[],
  maxCharacters = 240_000,
): { text: string; sourceFingerprint: string; sourceCharacters: number } {
  const nonEmpty = chapters
    .map((chapter) => ({ title: chapter.title.trim(), text: chapter.text.trim() }))
    .filter((chapter) => Boolean(chapter.text));
  if (nonEmpty.length === 0) throw new Error('The document has no narratable text to scan.');

  const hash = crypto.createHash('sha256');
  let sourceCharacters = 0;
  for (const chapter of nonEmpty) {
    hash.update(chapter.title);
    hash.update('\0');
    hash.update(chapter.text);
    hash.update('\0');
    sourceCharacters += chapter.text.length;
  }

  const headingAllowance = nonEmpty.reduce((total, chapter) => total + chapter.title.length + 20, 0);
  const perChapter = Math.max(200, Math.floor((maxCharacters - headingAllowance) / nonEmpty.length));
  const text = nonEmpty
    .map((chapter) => `### ${chapter.title || 'Untitled section'}\n${excerpt(chapter.text, perChapter)}`)
    .join('\n\n')
    .slice(0, maxCharacters);
  return {
    text,
    sourceFingerprint: `sha256:${hash.digest('hex')}`,
    sourceCharacters,
  };
}
