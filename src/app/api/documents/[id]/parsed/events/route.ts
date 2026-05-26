import { NextRequest, NextResponse } from 'next/server';
import { and, eq, inArray } from 'drizzle-orm';
import { db } from '@/db';
import { documents } from '@/db/schema';
import { requireAuthContext } from '@/lib/server/auth/auth';
import { readComputeMode } from '@/lib/server/compute/mode';
import { getParseProgressBus } from '@/lib/server/documents/parse-progress-bus';
import { hashUserId } from '@/lib/server/documents/parse-progress-events';
import { isValidDocumentId } from '@/lib/server/documents/blobstore';
import { normalizeParseStatus, parseDocumentParseState } from '@/lib/server/documents/parse-state';
import { healStaleDocumentParseState } from '@/lib/server/documents/parse-state-healing';
import { getOpenReaderTestNamespace, getUnclaimedUserIdForNamespace } from '@/lib/server/testing/test-namespace';
import { isS3Configured } from '@/lib/server/storage/s3';
import type { PdfParseProgress, PdfParseStatus } from '@/types/parsed-pdf';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const SSE_POLL_INTERVAL_MS = 1200;
const SSE_KEEPALIVE_MS = 15_000;
const SSE_RESYNC_INTERVAL_MS = 30_000;

type ParseRow = {
  id: string;
  userId: string;
  parseState: string | null;
};

type ParsedSnapshot = {
  parseStatus: PdfParseStatus;
  parseProgress: PdfParseProgress | null;
};

function s3NotConfiguredResponse(): NextResponse {
  return NextResponse.json(
    { error: 'Documents storage is not configured. Set S3_* environment variables.' },
    { status: 503 },
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function toSnapshot(row: ParseRow): Promise<ParsedSnapshot> {
  const state = await healStaleDocumentParseState({
    documentId: row.id,
    userId: row.userId,
    state: parseDocumentParseState(row.parseState),
  });
  const parseStatus = normalizeParseStatus(state.status);
  return {
    parseStatus,
    parseProgress: state.progress ?? null,
  };
}

async function loadPreferredRow(input: {
  documentId: string;
  storageUserId: string;
  allowedUserIds: string[];
}): Promise<ParseRow | null> {
  const rows = (await db
    .select({
      id: documents.id,
      userId: documents.userId,
      parseState: documents.parseState,
    })
    .from(documents)
    .where(and(eq(documents.id, input.documentId), inArray(documents.userId, input.allowedUserIds)))) as ParseRow[];

  return rows.find((candidate) => candidate.userId === input.storageUserId) ?? rows[0] ?? null;
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    if (!isS3Configured()) return s3NotConfiguredResponse();

    const authCtxOrRes = await requireAuthContext(req);
    if (authCtxOrRes instanceof Response) return authCtxOrRes;

    const params = await ctx.params;
    const id = (params.id || '').trim().toLowerCase();
    if (!isValidDocumentId(id)) {
      return NextResponse.json({ error: 'Invalid document id' }, { status: 400 });
    }

    const testNamespace = getOpenReaderTestNamespace(req.headers);
    const unclaimedUserId = getUnclaimedUserIdForNamespace(testNamespace);
    const storageUserId = authCtxOrRes.userId ?? unclaimedUserId;
    const allowedUserIds = authCtxOrRes.authEnabled ? [storageUserId, unclaimedUserId] : [unclaimedUserId];

    const row = await loadPreferredRow({
      documentId: id,
      storageUserId,
      allowedUserIds,
    });

    if (!row) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const initial = await toSnapshot(row);
    const computeMode = readComputeMode();
    const bus = computeMode === 'local' ? await getParseProgressBus() : null;

    const encoder = new TextEncoder();

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        let closed = false;
        let unsubscribe: (() => void) | null = null;
        let keepaliveTimer: ReturnType<typeof setInterval> | null = null;
        let resyncTimer: ReturnType<typeof setInterval> | null = null;

        const allowedUserHashes = new Set(allowedUserIds.map((candidate) => hashUserId(candidate)));

        const writeSnapshot = (snapshot: ParsedSnapshot): void => {
          controller.enqueue(encoder.encode(`event: snapshot\ndata: ${JSON.stringify(snapshot)}\n\n`));
        };

        const closeStream = (): void => {
          if (closed) return;
          closed = true;
          if (keepaliveTimer) {
            clearInterval(keepaliveTimer);
            keepaliveTimer = null;
          }
          if (resyncTimer) {
            clearInterval(resyncTimer);
            resyncTimer = null;
          }
          if (unsubscribe) {
            unsubscribe();
            unsubscribe = null;
          }
          try {
            controller.close();
          } catch {
            // no-op
          }
        };

        const syncFromDb = async (input: {
          signature: string;
        }): Promise<{ snapshot: ParsedSnapshot; signature: string } | null> => {
          const nextRow = await loadPreferredRow({
            documentId: id,
            storageUserId,
            allowedUserIds,
          });
          if (!nextRow) return null;

          const nextSnapshot = await toSnapshot(nextRow);
          const nextSignature = JSON.stringify(nextSnapshot);
          if (nextSignature !== input.signature) {
            writeSnapshot(nextSnapshot);
          }
          return {
            snapshot: nextSnapshot,
            signature: nextSignature,
          };
        };

        const runLocalRealtime = async () => {
          let current = initial;
          let signature = JSON.stringify(current);
          writeSnapshot(current);

          if (current.parseStatus === 'ready' || current.parseStatus === 'failed') {
            closeStream();
            return;
          }

          keepaliveTimer = setInterval(() => {
            if (closed) return;
            controller.enqueue(encoder.encode(': keepalive\n\n'));
          }, SSE_KEEPALIVE_MS);

          resyncTimer = setInterval(() => {
            if (closed) return;
            void syncFromDb({ signature }).then((next) => {
              if (closed) return;
              if (!next) {
                closeStream();
                return;
              }
              current = next.snapshot;
              signature = next.signature;
              if (current.parseStatus === 'ready' || current.parseStatus === 'failed') {
                closeStream();
              }
            }).catch((error) => {
              if (closed) return;
              controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify({ error: String(error) })}\n\n`));
              closeStream();
            });
          }, SSE_RESYNC_INTERVAL_MS);

          if (!bus) throw new Error('Local parse progress bus unavailable');
          const nextUnsubscribe = await bus.subscribe({
            documentId: id,
            userIdHashes: allowedUserHashes,
            onEvent: async () => {
              const next = await syncFromDb({ signature });
              if (!next) {
                closeStream();
                return;
              }
              current = next.snapshot;
              signature = next.signature;
              if (current.parseStatus === 'ready' || current.parseStatus === 'failed') {
                closeStream();
              }
            },
            onError: (error) => {
              if (closed) return;
              controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify({ error: String(error) })}\n\n`));
              closeStream();
            },
          });
          if (closed) {
            nextUnsubscribe();
            return;
          }
          unsubscribe = nextUnsubscribe;
        };

        const runWorkerPolling = async () => {
          let current = initial;
          writeSnapshot(current);
          let signature = JSON.stringify(current);

          while (!closed) {
            if (current.parseStatus === 'ready' || current.parseStatus === 'failed') break;
            await sleep(SSE_POLL_INTERVAL_MS);
            if (closed) break;

            const next = await syncFromDb({ signature });
            if (!next) break;
            current = next.snapshot;
            signature = next.signature;
          }
        };

        const run = computeMode === 'local' ? runLocalRealtime : runWorkerPolling;

        void run()
          .catch((error) => {
            if (!closed) {
              controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify({ error: String(error) })}\n\n`));
            }
          })
          .finally(() => {
            closeStream();
          });

        req.signal.addEventListener('abort', () => {
          closeStream();
        }, { once: true });
      },
      cancel() {
        return;
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    });
  } catch (error) {
    console.error('Error streaming parsed PDF progress:', error);
    return NextResponse.json({ error: 'Failed to stream parsed PDF progress' }, { status: 500 });
  }
}
