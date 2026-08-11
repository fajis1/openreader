import { NextRequest, NextResponse } from 'next/server';
import { requireAdminContext } from '@/lib/server/auth/admin';
import { grantSupportCredits } from '@/lib/server/admin/support';

export const dynamic = 'force-dynamic';

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await requireAdminContext(req);
  if (ctx instanceof Response) return ctx;
  const { id } = await params;
  let body: Record<string, unknown>;
  try {
    body = await req.json() as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 });
  }
  try {
    const ledger = await grantSupportCredits({
      adminUserId: ctx.user.id,
      targetUserId: id,
      credits: Math.floor(Number(body.credits ?? 5)),
      note: typeof body.note === 'string' ? body.note : null,
      idempotencyKey: typeof body.idempotencyKey === 'string' ? body.idempotencyKey : undefined,
    });
    return NextResponse.json({
      ok: true,
      available: ledger.available,
      grantedTotal: ledger.grantedTotal,
      consumedTotal: ledger.consumedTotal,
      outstandingDebt: ledger.outstandingDebt,
    });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Unable to grant credits.',
    }, { status: 400 });
  }
}
