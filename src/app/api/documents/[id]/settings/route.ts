import { NextRequest, NextResponse } from 'next/server';
import { and, eq, sql } from 'drizzle-orm';
import { db } from '@/db';
import { documentSettings, documents } from '@/db/schema';
import { requireAuthContext } from '@/lib/server/auth/auth';
import {
  mergeDocumentSettings,
} from '@/lib/shared/document-settings';
import { DEFAULT_DOCUMENT_SETTINGS, type DocumentSettings } from '@/types/document-settings';
import { coerceTimestampMs, nowTimestampMs } from '@/lib/shared/timestamps';
import { errorToLog, serverLogger } from '@/lib/server/logger';
import { errorResponse } from '@/lib/server/errors/next-response';

export const dynamic = 'force-dynamic';

function serializeForDb(payload: Record<string, unknown>): Record<string, unknown> | string {
  if (process.env.POSTGRES_URL) return payload;
  return JSON.stringify(payload);
}

function normalizeClientUpdatedAtMs(value: unknown): number {
  const normalized = coerceTimestampMs(value, nowTimestampMs());
  if (normalized <= 0) return nowTimestampMs();
  return normalized;
}

function parseStored(value: unknown): DocumentSettings {
  if (typeof value === 'string') {
    try {
      return mergeDocumentSettings(DEFAULT_DOCUMENT_SETTINGS, JSON.parse(value));
    } catch {
      return mergeDocumentSettings(DEFAULT_DOCUMENT_SETTINGS, null);
    }
  }
  return mergeDocumentSettings(DEFAULT_DOCUMENT_SETTINGS, value);
}

async function resolveDocumentAccess(req: NextRequest, documentId: string): Promise<
  | { ownerUserId: string }
  | Response
> {
  const authCtxOrRes = await requireAuthContext(req);
  if (authCtxOrRes instanceof Response) return authCtxOrRes;
  if (!authCtxOrRes.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const storageUserId = authCtxOrRes.userId;

  const rows = await db
    .select({ userId: documents.userId })
    .from(documents)
    .where(and(eq(documents.id, documentId), eq(documents.userId, storageUserId)))
    .limit(1);

  if (!rows[0]) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  return {
    ownerUserId: rows[0].userId,
  };
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const documentId = (id || '').trim().toLowerCase();
    if (!documentId) {
      return NextResponse.json({ error: 'Invalid document id' }, { status: 400 });
    }

    const scope = await resolveDocumentAccess(req, documentId);
    if (scope instanceof Response) return scope;

    const rows = await db
      .select({
        dataJson: documentSettings.dataJson,
        clientUpdatedAtMs: documentSettings.clientUpdatedAtMs,
      })
      .from(documentSettings)
      .where(and(
        eq(documentSettings.documentId, documentId),
        eq(documentSettings.userId, scope.ownerUserId),
      ))
      .limit(1);

    const row = rows[0];
    const settings = parseStored(row?.dataJson);

    return NextResponse.json({
      settings,
      clientUpdatedAtMs: Number(row?.clientUpdatedAtMs ?? 0),
      hasStoredSettings: Boolean(row),
    });
  } catch (error) {
    serverLogger.error({
      event: 'documents.settings.load.failed',
      error: errorToLog(error),
    }, 'Failed to load document settings');
    return errorResponse(error, {
      apiErrorMessage: 'Failed to load document settings',
      normalize: { code: 'DOCUMENTS_SETTINGS_LOAD_FAILED', errorClass: 'db' },
    });
  }
}

export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params;
    const documentId = (id || '').trim().toLowerCase();
    if (!documentId) {
      return NextResponse.json({ error: 'Invalid document id' }, { status: 400 });
    }

    const scope = await resolveDocumentAccess(req, documentId);
    if (scope instanceof Response) return scope;

    const body = (await req.json().catch(() => null)) as { settings?: unknown; clientUpdatedAtMs?: unknown } | null;
    const incoming = mergeDocumentSettings(DEFAULT_DOCUMENT_SETTINGS, body?.settings ?? null);
    const clientUpdatedAtMs = normalizeClientUpdatedAtMs(body?.clientUpdatedAtMs);

    const existingRows = await db
      .select({
        dataJson: documentSettings.dataJson,
        clientUpdatedAtMs: documentSettings.clientUpdatedAtMs,
      })
      .from(documentSettings)
      .where(and(
        eq(documentSettings.documentId, documentId),
        eq(documentSettings.userId, scope.ownerUserId),
      ))
      .limit(1);

    const existing = existingRows[0];
    const existingUpdatedAt = Number(existing?.clientUpdatedAtMs ?? 0);
    if (existing && clientUpdatedAtMs < existingUpdatedAt) {
      return NextResponse.json({
        settings: parseStored(existing.dataJson),
        clientUpdatedAtMs: existingUpdatedAt,
        applied: false,
      });
    }

    // smartAudioLexicon is server-managed scan state. Do not accept it from the
    // client, and preserve the database's current value inside the upsert so a
    // scan completing between the SELECT and UPDATE cannot be overwritten.
    const clientManagedIncoming = { ...incoming };
    delete clientManagedIncoming.smartAudioLexicon;
    const updatedAt = nowTimestampMs();
    const incomingJson = JSON.stringify(clientManagedIncoming);
    const payload = serializeForDb(clientManagedIncoming as unknown as Record<string, unknown>);
    const mergedDataJson = process.env.POSTGRES_URL
      ? sql`case
          when ${documentSettings.dataJson} ? 'smartAudioLexicon'
          then jsonb_set(${incomingJson}::jsonb, '{smartAudioLexicon}', ${documentSettings.dataJson}->'smartAudioLexicon', true)
          else ${incomingJson}::jsonb
        end`
      : sql`case
          when json_type(${documentSettings.dataJson}, '$.smartAudioLexicon') is not null
          then json_set(json(${incomingJson}), '$.smartAudioLexicon', json_extract(${documentSettings.dataJson}, '$.smartAudioLexicon'))
          else json(${incomingJson})
        end`;

    const savedRows = await db
      .insert(documentSettings)
      .values({
        documentId,
        userId: scope.ownerUserId,
        dataJson: payload as never,
        clientUpdatedAtMs,
        updatedAt,
      })
      .onConflictDoUpdate({
        target: [documentSettings.documentId, documentSettings.userId],
        set: {
          dataJson: mergedDataJson as never,
          clientUpdatedAtMs,
          updatedAt,
        },
      })
      .returning({ dataJson: documentSettings.dataJson });
    const savedSettings = parseStored(savedRows[0]?.dataJson);

    return NextResponse.json({
      settings: savedSettings,
      clientUpdatedAtMs,
      applied: true,
    });
  } catch (error) {
    serverLogger.error({
      event: 'documents.settings.update.failed',
      error: errorToLog(error),
    }, 'Failed to update document settings');
    return errorResponse(error, {
      apiErrorMessage: 'Failed to update document settings',
      normalize: { code: 'DOCUMENTS_SETTINGS_UPDATE_FAILED', errorClass: 'db' },
    });
  }
}
