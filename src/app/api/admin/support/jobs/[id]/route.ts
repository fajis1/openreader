import { NextRequest, NextResponse } from 'next/server';
import { requireAdminContext } from '@/lib/server/auth/admin';
import { updateSupportJob } from '@/lib/server/admin/support';

export const dynamic = 'force-dynamic';

export async function PATCH(
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
  const action = body.action;
  if (action !== 'pause' && action !== 'resume' && action !== 'retry') {
    return NextResponse.json({ error: 'Action must be pause, resume, or retry.' }, { status: 400 });
  }
  try {
    const job = await updateSupportJob({
      adminUserId: ctx.user.id,
      jobId: id,
      action,
      note: typeof body.note === 'string' ? body.note : null,
    });
    if (!job) return NextResponse.json({ error: 'Job not found.' }, { status: 404 });
    return NextResponse.json({ ok: true, job });
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Unable to update job.',
    }, { status: 409 });
  }
}
