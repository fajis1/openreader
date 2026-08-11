import { NextRequest, NextResponse } from 'next/server';
import { checkMonthlyAudiobookQuota } from '@/lib/server/access/audiobook-quota';
import { requireAuthContext } from '@/lib/server/auth/auth';
import { errorResponse } from '@/lib/server/errors/next-response';
import { errorToLog, serverLogger } from '@/lib/server/logger';
import { getPayPalReadiness } from '@/lib/server/paypal/config';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAuthContext(request);
    if (ctx instanceof Response) return ctx;
    if (!ctx.userId) return new NextResponse('Unauthorized', { status: 401 });

    const quota = await checkMonthlyAudiobookQuota({
      userId: ctx.userId,
      isAdmin: Boolean((ctx.user as unknown as { isAdmin?: boolean | null })?.isAdmin),
    });
    const paypal = getPayPalReadiness();

    return NextResponse.json({
      unlimited: quota.unlimited,
      used: quota.used,
      freeLimit: quota.freeLimit,
      freeUsed: quota.freeUsed,
      freeRemaining: quota.freeRemaining,
      supportCreditsRemaining: quota.supportCreditsRemaining,
      totalRemaining: quota.totalRemaining,
      resetTimeMs: quota.resetTimeMs,
      supportServerUrl: quota.supportServerUrl || null,
      supportMinimumUsd: quota.supportMinimumUsd,
      supportExtraAudiobooks: quota.supportExtraAudiobooks,
      paypalEnabled: paypal.enabled && !ctx.user?.isAnonymous,
    });
  } catch (error) {
    serverLogger.error({
      event: 'audiobook.quota.get.failed',
      error: errorToLog(error),
    }, 'Failed to load audiobook allowance');
    return errorResponse(error, { apiErrorMessage: 'Failed to load audiobook allowance' });
  }
}
