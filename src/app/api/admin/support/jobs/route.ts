import { NextRequest, NextResponse } from 'next/server';
import { requireAdminContext } from '@/lib/server/auth/admin';
import { listSupportJobs } from '@/lib/server/admin/support';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const ctx = await requireAdminContext(req);
  if (ctx instanceof Response) return ctx;
  const url = new URL(req.url);
  return NextResponse.json(await listSupportJobs({
    status: url.searchParams.get('status') || 'all',
    query: url.searchParams.get('q') || '',
    page: Number(url.searchParams.get('page') || 1),
    pageSize: Number(url.searchParams.get('pageSize') || 50),
  }));
}
