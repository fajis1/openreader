import { and, eq } from 'drizzle-orm';
import { getComputeOpStaleMs } from '@openreader/compute-core';
import { db } from '@/db';
import { documents } from '@/db/schema';
import {
  isDocumentParseStateStale,
  parseDocumentParseState,
  stringifyDocumentParseState,
  type DocumentParseState,
} from '@/lib/server/documents/parse-state';
import { getParseProgressBus } from '@/lib/server/documents/parse-progress-bus';
import { hashUserId } from '@/lib/server/documents/parse-progress-events';

export async function healStaleDocumentParseState(input: {
  documentId: string;
  userId: string;
  state: DocumentParseState;
}): Promise<DocumentParseState> {
  const staleMs = getComputeOpStaleMs();
  if (!isDocumentParseStateStale(input.state, staleMs)) return input.state;

  const nextState = parseDocumentParseState(stringifyDocumentParseState({
    status: 'failed',
    progress: null,
    updatedAt: Date.now(),
    error: `Parse state stale for more than ${staleMs}ms; marked failed for retry`,
  }));

  await db
    .update(documents)
    .set({ parseState: stringifyDocumentParseState(nextState) })
    .where(and(eq(documents.id, input.documentId), eq(documents.userId, input.userId)));

  try {
    const bus = await getParseProgressBus();
    await bus.publish({
      version: 1,
      documentId: input.documentId,
      userIdHash: hashUserId(input.userId),
      parseStatus: nextState.status,
      parseProgress: nextState.progress ?? null,
      updatedAt: nextState.updatedAt ?? Date.now(),
      ...(nextState.opId ? { opId: nextState.opId } : {}),
      ...(nextState.jobId ? { jobId: nextState.jobId } : {}),
      ...(nextState.error ? { error: nextState.error } : {}),
    });
  } catch (error) {
    console.warn('[parse-state-healing] failed to publish stale state event', {
      documentId: input.documentId,
      userId: input.userId,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return nextState;
}
