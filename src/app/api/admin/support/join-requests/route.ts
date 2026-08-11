import { NextRequest, NextResponse } from 'next/server';
import { decideJoinRequestById, listJoinRequests } from '@/lib/server/access/join-requests';
import { requireAdminContext } from '@/lib/server/auth/admin';
import { recordSupportAudit } from '@/lib/server/admin/support';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const ctx = await requireAdminContext(req);
  if (ctx instanceof Response) return ctx;
  return NextResponse.json({ requests: await listJoinRequests() });
}

export async function PATCH(req: NextRequest) {
  const ctx = await requireAdminContext(req);
  if (ctx instanceof Response) return ctx;
  let body: Record<string, unknown>;
  try {
    body = await req.json() as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 });
  }
  const requestId = typeof body.requestId === 'string' ? body.requestId : '';
  const decision = body.decision;
  if (!requestId || (decision !== 'approve' && decision !== 'deny')) {
    return NextResponse.json({ error: 'A request ID and valid decision are required.' }, { status: 400 });
  }
  const request = await decideJoinRequestById({
    requestId,
    decision,
    decisionNote: typeof body.note === 'string' ? body.note : null,
  });
  if (!request) return NextResponse.json({ error: 'Join request not found.' }, { status: 404 });
  await recordSupportAudit({
    adminUserId: ctx.user.id,
    action: `join_request_${decision}`,
    resourceId: request.id,
    note: typeof body.note === 'string' ? body.note : null,
  });
  return NextResponse.json({ ok: true, request });
}
