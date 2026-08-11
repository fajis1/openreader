import { NextRequest, NextResponse } from 'next/server';
import { requireAdminContext } from '@/lib/server/auth/admin';
import { listSupportSystemLogs } from '@/lib/server/admin/support';
import { listTasks } from '@/lib/server/tasks/engine';
import { getTaskSchedulerInfo } from '@/lib/server/tasks/scheduler';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  const ctx = await requireAdminContext(req);
  if (ctx instanceof Response) return ctx;
  const [logs, tasks] = await Promise.all([listSupportSystemLogs(100), listTasks()]);
  return NextResponse.json({ logs, tasks, scheduler: getTaskSchedulerInfo() });
}
