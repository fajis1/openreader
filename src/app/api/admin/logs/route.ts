import { NextResponse } from 'next/server';
import { db } from '@/db';
import { systemLogs } from '@/db/schema';
import { requireAuthContext } from '@/lib/server/auth/auth';
import { desc } from 'drizzle-orm';
import { v4 as uuidv4 } from 'uuid';

export async function GET(req: Request) {
  try {
    const { user } = await requireAuthContext(req);
    // In a real app we might check if user is admin, but for now we'll allow authenticated users
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const logs = await db.select().from(systemLogs).orderBy(desc(systemLogs.createdAt)).limit(100);
    return NextResponse.json(logs);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    // Some endpoints can push logs
    const { severity, context, message, details } = await req.json();
    await db.insert(systemLogs).values({
      id: uuidv4(),
      severity: severity || 'info',
      context: context || 'system',
      message: message || 'Unknown event',
      details: details ? (typeof details === 'string' ? details : JSON.stringify(details)) : null
    });
    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
