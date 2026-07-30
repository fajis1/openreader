import { NextRequest, NextResponse } from 'next/server';
import { requireAuthContext } from '@/lib/server/auth/auth';
import { db } from '@/db';
import { adminSettings } from '@/db/schema';
import { eq } from 'drizzle-orm';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const ctxOrRes = await requireAuthContext(req);
    if (ctxOrRes instanceof Response) return ctxOrRes;

    const jobId = new URL(req.url).searchParams.get('jobId');
    if (!jobId) return NextResponse.json({ error: 'Missing jobId' }, { status: 400 });

    const rows = await db.select({ valueJson: adminSettings.valueJson })
      .from(adminSettings)
      .where(eq(adminSettings.key, `foreign_word_scan:${jobId}`))
      .limit(1);
    if (rows.length === 0 || !rows[0].valueJson) {
      return NextResponse.json({ error: 'Scan job not found' }, { status: 404 });
    }

    const job = typeof rows[0].valueJson === 'string' ? JSON.parse(rows[0].valueJson) : rows[0].valueJson;
    if (!job || job.userId !== ctxOrRes.userId) {
      return NextResponse.json({ error: 'Scan job not found' }, { status: 404 });
    }

    return NextResponse.json(job);
  } catch (error: any) {
    console.error('Foreign-word scan status error:', error);
    return NextResponse.json({ error: error?.message || 'Failed to load scan status' }, { status: 500 });
  }
}
