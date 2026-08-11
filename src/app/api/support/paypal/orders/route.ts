import { NextRequest, NextResponse } from 'next/server';
import { requireAuthContext } from '@/lib/server/auth/auth';
import { getPayPalConfig } from '@/lib/server/paypal/config';
import { createSupportPayment, PayPalCheckoutError } from '@/lib/server/paypal/payments';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const ctx = await requireAuthContext(request, { requireNonAnonymous: true });
  if (ctx instanceof Response) return ctx;

  try {
    const expectedOrigin = getPayPalConfig().siteOrigin;
    const requestOrigin = request.headers.get('origin')?.trim();
    if (requestOrigin && requestOrigin !== expectedOrigin) {
      return NextResponse.json({ error: 'Invalid request origin.' }, { status: 403 });
    }
    const body = await request.json().catch(() => null) as {
      amountUsd?: unknown;
      credits?: unknown;
    } | null;
    if (
      typeof body?.amountUsd !== 'number'
      || typeof body?.credits !== 'number'
      || !Number.isInteger(body.amountUsd)
      || !Number.isInteger(body.credits)
    ) {
      return NextResponse.json({ error: 'Invalid support package.' }, { status: 400 });
    }
    const checkout = await createSupportPayment({
      userId: ctx.userId!,
      expectedAmountUsd: body.amountUsd,
      expectedCredits: body.credits,
    });
    return NextResponse.json({ approvalUrl: checkout.approvalUrl }, {
      status: 201,
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    const status = error instanceof PayPalCheckoutError ? error.status : 503;
    const code = error instanceof PayPalCheckoutError ? error.code : 'paypal_unavailable';
    return NextResponse.json({
      error: code === 'support_package_changed'
        ? 'The support package changed. Review the updated amount and try again.'
        : status === 503
          ? 'PayPal checkout is not available right now.'
          : 'Unable to start PayPal checkout.',
      code,
    }, { status, headers: { 'Cache-Control': 'no-store' } });
  }
}
