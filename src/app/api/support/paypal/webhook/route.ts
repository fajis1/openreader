import { NextRequest, NextResponse } from 'next/server';
import { PayPalCheckoutError, processPayPalWebhook } from '@/lib/server/paypal/payments';
import { errorToLog, serverLogger } from '@/lib/server/logger';

export const dynamic = 'force-dynamic';
const MAX_WEBHOOK_BYTES = 1_000_000;

async function readLimitedWebhookBody(request: NextRequest): Promise<string | null> {
  if (!request.body) return '';
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let bytesRead = 0;
  let body = '';
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    bytesRead += chunk.value.byteLength;
    if (bytesRead > MAX_WEBHOOK_BYTES) {
      await reader.cancel();
      return null;
    }
    body += decoder.decode(chunk.value, { stream: true });
  }
  return body + decoder.decode();
}

export async function POST(request: NextRequest) {
  const declaredLength = Number(request.headers.get('content-length') || 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_WEBHOOK_BYTES) {
    return NextResponse.json({ error: 'Webhook payload is too large.' }, { status: 413 });
  }

  try {
    const rawBody = await readLimitedWebhookBody(request);
    if (rawBody === null) {
      return NextResponse.json({ error: 'Webhook payload is too large.' }, { status: 413 });
    }
    let event: unknown;
    try {
      event = JSON.parse(rawBody);
    } catch {
      return NextResponse.json({ error: 'Invalid webhook JSON.' }, { status: 400 });
    }
    const result = await processPayPalWebhook({ headers: request.headers, event });
    return NextResponse.json({ received: true, status: result.status }, {
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    const status = error instanceof PayPalCheckoutError ? error.status : 503;
    serverLogger.error({
      event: 'paypal.webhook.failed',
      error: errorToLog(error),
    }, 'PayPal webhook was rejected or could not be processed');
    return NextResponse.json({
      error: status === 400 ? 'Invalid PayPal webhook.' : 'PayPal webhook processing is unavailable.',
    }, { status, headers: { 'Cache-Control': 'no-store' } });
  }
}
