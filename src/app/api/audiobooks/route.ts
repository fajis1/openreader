import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db';
import { audiobooks } from '@/db/schema';
import { requireAuthContext } from '@/lib/server/auth/auth';
import { eq } from 'drizzle-orm';
import { serverLogger, errorToLog } from '@/lib/server/logger';
import { errorResponse } from '@/lib/server/errors/next-response';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const ctxOrRes = await requireAuthContext(request);
    if (ctxOrRes instanceof Response) return ctxOrRes;
    if (!ctxOrRes.userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const userAudiobooks = await db
      .select({ id: audiobooks.id, hasSmartAudio: audiobooks.hasSmartAudio, totalBytes: audiobooks.totalBytes })
      .from(audiobooks)
      .where(eq(audiobooks.userId, ctxOrRes.userId));

    return NextResponse.json({ 
      audiobooks: userAudiobooks.map((b: any) => b.id),
      smartAudiobookIds: userAudiobooks.filter((b: any) => b.hasSmartAudio).map((b: any) => b.id),
      audiobookSizes: Object.fromEntries(userAudiobooks.filter((b: any) => b.totalBytes).map((b: any) => [b.id, b.totalBytes]))
    });
  } catch (error) {
    serverLogger.error({
      event: 'audiobooks.list.error',
      error: errorToLog(error),
    }, 'Failed to list audiobooks');
    return errorResponse(error, { apiErrorMessage: 'Failed to list audiobooks' });
  }
}
