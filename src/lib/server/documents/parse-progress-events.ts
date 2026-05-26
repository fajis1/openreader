import { createHash } from 'node:crypto';
import type { PdfParseProgress, PdfParseStatus } from '@/types/parsed-pdf';

export interface ParseProgressEvent {
  version: 1;
  documentId: string;
  userIdHash: string;
  parseStatus: PdfParseStatus;
  parseProgress: PdfParseProgress | null;
  updatedAt: number;
  opId?: string;
  jobId?: string;
  error?: string | null;
}

export function hashUserId(userId: string): string {
  return createHash('sha256').update(userId).digest('hex').slice(0, 24);
}
