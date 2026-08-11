import { NextRequest, NextResponse } from 'next/server';
import { getAuthContext } from '@/lib/server/auth/auth';
import { getPayPalConfig } from '@/lib/server/paypal/config';
import { captureSupportPayment } from '@/lib/server/paypal/payments';
import { errorToLog, hashForLog, serverLogger } from '@/lib/server/logger';
import { tryGetOrigin } from '@/lib/shared/urls';

export const dynamic = 'force-dynamic';

function normalizeOrderId(value: string | null): string | null {
  const orderId = value?.trim() || '';
  return /^[A-Za-z0-9_-]{1,200}$/.test(orderId) ? orderId : null;
}

function readerRedirect(request: NextRequest, status: string): NextResponse {
  const origin = tryGetOrigin(process.env.BASE_URL) || new URL(request.url).origin;
  return NextResponse.redirect(new URL(`/app?paypal=${encodeURIComponent(status)}`, origin), {
    headers: { 'Cache-Control': 'no-store' },
  });
}

export async function GET(request: NextRequest) {
  const orderId = normalizeOrderId(request.nextUrl.searchParams.get('token'));
  const ctx = await getAuthContext(request);
  if (!ctx.userId || ctx.user?.isAnonymous) {
    const origin = tryGetOrigin(process.env.BASE_URL) || new URL(request.url).origin;
    const signInUrl = new URL('/signin', origin);
    signInUrl.searchParams.set('reason', 'payment-return');
    if (orderId) {
      signInUrl.searchParams.set(
        'callbackURL',
        `/api/support/paypal/return?token=${encodeURIComponent(orderId)}`,
      );
    }
    return NextResponse.redirect(signInUrl, {
      headers: { 'Cache-Control': 'no-store' },
    });
  }
  if (!orderId) return readerRedirect(request, 'error');

  try {
    // Resolve configuration before capture so a deployment error is handled by
    // the bounded redirect below without exposing details in the query string.
    getPayPalConfig();
    const result = await captureSupportPayment({ userId: ctx.userId, orderId });
    return readerRedirect(
      request,
      result.status === 'completed' ? 'success' : result.status === 'pending' ? 'pending' : 'error',
    );
  } catch (error) {
    serverLogger.error({
      event: 'paypal.order.capture.failed',
      userIdHash: hashForLog(ctx.userId),
      orderIdHash: hashForLog(orderId),
      error: errorToLog(error),
    }, 'Failed to capture PayPal support order');
    return readerRedirect(request, 'error');
  }
}
