import { NextResponse, type NextRequest } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { requireAdminContext } from '@/lib/server/auth/admin';
import { grantSupportCredits } from '@/lib/server/admin/support';
import { errorToLog, serverLogger } from '@/lib/server/logger';
import * as authSchemaSqlite from '@/db/schema_auth_sqlite';
import * as authSchemaPostgres from '@/db/schema_auth_postgres';

const authUser = process.env.POSTGRES_URL ? authSchemaPostgres.user : authSchemaSqlite.user;

function normalizeEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}
async function resolveUserId(input: { userId?: unknown; email?: unknown }): Promise<string | null> {
  if (typeof input.userId === 'string' && input.userId.trim()) return input.userId.trim();
  const email = normalizeEmail(input.email);
  if (!email) return null;
  const rows = await db.select({ id: authUser.id })
    .from(authUser)
    .where(eq(authUser.email, email))
    .limit(1);
  return rows[0]?.id ?? null;
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireAdminContext(req);
    if (ctx instanceof Response) return ctx;

    const body = await req.json();
    const userId = await resolveUserId({ userId: body?.userId, email: body?.email });
    if (!userId) {
      return NextResponse.json({ error: 'User not found. Provide an existing userId or account email.' }, { status: 404 });
    }
    const credits = Math.floor(Number(body?.credits ?? 5));
    const ledger = await grantSupportCredits({
      adminUserId: ctx.user.id,
      targetUserId: userId,
      credits,
      note: typeof body?.note === 'string' ? body.note : null,
      idempotencyKey: typeof body?.idempotencyKey === 'string' ? body.idempotencyKey : undefined,
    });
    return NextResponse.json({
      ok: true,
      userId,
      available: ledger.available,
      grantedTotal: ledger.grantedTotal,
      consumedTotal: ledger.consumedTotal,
    });
  } catch (error) {
    serverLogger.error({ event: 'admin.audiobook_credits.grant.failed', error: errorToLog(error) }, 'Failed to grant audiobook credits');
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Failed to grant audiobook credits.',
    }, { status: 400 });
  }
}
