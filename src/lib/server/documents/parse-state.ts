import { PDF_PARSER_VERSION } from '@openreader/compute-core';
import type { ParsedPdfDocument, PdfParseProgress, PdfParseStatus } from '@/types/parsed-pdf';

export interface DocumentParseState {
  status: PdfParseStatus;
  progress?: PdfParseProgress | null;
  updatedAt?: number;
  error?: string | null;
  opId?: string;
  jobId?: string;
  parserVersion?: string;
}

export function isInProgressParseStatus(status: PdfParseStatus): status is 'pending' | 'running' {
  return status === 'pending' || status === 'running';
}

export function isDocumentParseStateStale(
  state: DocumentParseState,
  staleMs: number,
  nowMs = Date.now(),
): boolean {
  if (!isInProgressParseStatus(state.status)) return false;
  if (!Number.isFinite(staleMs) || staleMs <= 0) return false;
  const updatedAt = Number(state.updatedAt ?? 0);
  if (!Number.isFinite(updatedAt) || updatedAt <= 0) return false;
  return (nowMs - updatedAt) > staleMs;
}

export function normalizeParseStatus(status: string | null | undefined): PdfParseStatus {
  if (status === 'pending' || status === 'running' || status === 'ready' || status === 'failed') {
    return status;
  }
  return 'pending';
}

export function hasCurrentPdfParserVersion(parserVersion: string | null | undefined): boolean {
  return typeof parserVersion === 'string' && parserVersion.trim() === PDF_PARSER_VERSION;
}

export function normalizeDocumentParseStateForCurrentParserVersion(
  state: DocumentParseState,
  nowMs = Date.now(),
): DocumentParseState {
  const status = normalizeParseStatus(state.status);
  if (status === 'failed' || hasCurrentPdfParserVersion(state.parserVersion)) {
    return state;
  }

  return {
    status: 'pending',
    progress: null,
    updatedAt: nowMs,
  };
}

export function resolveParsedPdfParserVersion(parsed: ParsedPdfDocument | null | undefined): string {
  const parserVersion = parsed?.parserVersion?.trim();
  return parserVersion || PDF_PARSER_VERSION;
}

function normalizeProgress(progress: unknown): PdfParseProgress | null {
  if (!progress || typeof progress !== 'object') return null;
  const rec = progress as Record<string, unknown>;
  const totalPages = Number(rec.totalPages ?? 0);
  if (!Number.isFinite(totalPages) || totalPages <= 0) return null;
  const pagesParsedRaw = Number(rec.pagesParsed ?? 0);
  const pagesParsed = Math.max(0, Math.min(totalPages, Number.isFinite(pagesParsedRaw) ? pagesParsedRaw : 0));
  const phase = rec.phase === 'merge' ? 'merge' : 'infer';
  const currentPageRaw = Number(rec.currentPage ?? pagesParsed);
  const currentPage = Number.isFinite(currentPageRaw) && currentPageRaw > 0
    ? Math.max(1, Math.min(totalPages, currentPageRaw))
    : undefined;
  return {
    totalPages,
    pagesParsed,
    currentPage,
    phase,
  };
}

export function parseDocumentParseState(value: string | null): DocumentParseState {
  if (!value) return { status: 'pending', progress: null };
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    const status = normalizeParseStatus(typeof parsed.status === 'string' ? parsed.status : null);
    const progress = normalizeProgress(parsed.progress);
    const updatedAtRaw = Number(parsed.updatedAt ?? 0);
    const updatedAt = Number.isFinite(updatedAtRaw) && updatedAtRaw > 0 ? updatedAtRaw : undefined;
    const error = typeof parsed.error === 'string' ? parsed.error : null;
    const opId = typeof parsed.opId === 'string' ? parsed.opId : undefined;
    const jobId = typeof parsed.jobId === 'string' ? parsed.jobId : undefined;
    const parserVersion = typeof parsed.parserVersion === 'string' ? parsed.parserVersion : undefined;
    return {
      status,
      progress,
      ...(typeof updatedAt === 'number' ? { updatedAt } : {}),
      ...(error ? { error } : {}),
      ...(opId ? { opId } : {}),
      ...(jobId ? { jobId } : {}),
      ...(parserVersion ? { parserVersion } : {}),
    };
  } catch {
    return { status: 'pending', progress: null };
  }
}

export function stringifyDocumentParseState(state: DocumentParseState): string {
  return JSON.stringify({
    status: normalizeParseStatus(state.status),
    progress: state.progress ?? null,
    updatedAt: typeof state.updatedAt === 'number' ? state.updatedAt : Date.now(),
    ...(state.error ? { error: state.error } : {}),
    ...(state.opId ? { opId: state.opId } : {}),
    ...(state.jobId ? { jobId: state.jobId } : {}),
    ...(state.parserVersion ? { parserVersion: state.parserVersion } : {}),
  });
}
