import { NextRequest, NextResponse } from 'next/server';
import { requireAdminContext } from '@/lib/server/auth/admin';
import { getSupportUserDetail } from '@/lib/server/admin/support';

export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const ctx = await requireAdminContext(req);
  if (ctx instanceof Response) return ctx;
  const { id } = await params;
  const detail = await getSupportUserDetail(id);
  if (!detail) return NextResponse.json({ error: 'User not found.' }, { status: 404 });
  return NextResponse.json(detail);
}
