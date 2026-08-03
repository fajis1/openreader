import { NextRequest, NextResponse } from 'next/server';
import { requireAuthContext } from '@/lib/server/auth/auth';
import { db } from '@/db';
import { adminSettings } from '@/db/schema';
import { eq, like } from 'drizzle-orm';
import { findLatestForeignWordScanJob } from '@/lib/server/smart-audio/gemini-foreign-word-scan';
import { errorResponse } from '@/lib/server/errors/next-response';
import { serverLogger } from '@/lib/server/logger';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const ctxOrRes = await requireAuthContext(req);
    if (ctxOrRes instanceof Response) return ctxOrRes;
    const userId = ctxOrRes.userId;
    if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const searchParams = new URL(req.url).searchParams;
    const jobId = searchParams.get('jobId');
    const documentId = searchParams.get('documentId');
    if (!jobId && !documentId) {
      return NextResponse.json({ error: 'Missing jobId or documentId' }, { status: 400 });
    }

    if (jobId) {
      const rows = await db.select({ valueJson: adminSettings.valueJson })
        .from(adminSettings)
        .where(eq(adminSettings.key, `foreign_word_scan:${jobId}`))
        .limit(1);
      if (rows.length === 0 || !rows[0].valueJson) {
        return NextResponse.json({ error: 'Scan job not found' }, { status: 404 });
      }

      const job = typeof rows[0].valueJson === 'string' ? JSON.parse(rows[0].valueJson) : rows[0].valueJson;
      if (!job || job.userId !== userId) {
        return NextResponse.json({ error: 'Scan job not found' }, { status: 404 });
      }
      return NextResponse.json(job);
    }

    const rows = await db.select({ valueJson: adminSettings.valueJson })
      .from(adminSettings)
      .where(like(adminSettings.key, 'foreign_word_scan:%'));
    const job = findLatestForeignWordScanJob(
      rows.map((row: { valueJson: unknown }) => row.valueJson),
      userId,
      documentId as string,
    );
    if (!job) return NextResponse.json({ error: 'Scan job not found' }, { status: 404 });
    return NextResponse.json(job);
  } catch (error) {
    return errorResponse(error, {
      logger: serverLogger,
      event: 'pdf.scan.status.failed',
      msg: 'Failed to load foreign-word scan status',
      apiErrorMessage: 'Failed to load scan status',
    });
  }
}
