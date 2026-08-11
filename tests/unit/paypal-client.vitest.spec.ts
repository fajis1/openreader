import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import {
  createPayPalOrderRequest,
  resetPayPalClientCacheForTests,
  verifyPayPalWebhookRequest,
} from '../../src/lib/server/paypal/client';
import type { PayPalConfig } from '../../src/lib/server/paypal/config';
import {
  classifyPayPalCaptureStatus,
  classifyPayPalWebhookReplay,
  extractPayPalRefundCaptureId,
  isSafePayPalApprovalUrl,
  paypalAmountToCents,
} from '../../src/lib/server/paypal/payments';

const config: PayPalConfig = {
  environment: 'sandbox',
  apiBaseUrl: 'https://api-m.sandbox.paypal.com',
  clientId: 'test-client-id',
  clientSecret: 'test-client-secret',
  webhookId: 'test-webhook-id',
  merchantId: null,
  siteOrigin: 'http://reader.test',
};

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('PayPal server client', () => {
  beforeEach(() => resetPayPalClientCacheForTests());

  test('creates only the fixed server-provided package and keeps credentials out of the order body', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ access_token: 'server-access-token', expires_in: 3600 }))
      .mockResolvedValueOnce(jsonResponse({
        id: 'ORDER-1',
        status: 'PAYER_ACTION_REQUIRED',
        links: [{ rel: 'payer-action', href: 'https://www.sandbox.paypal.com/checkoutnow?token=ORDER-1' }],
      })) as unknown as typeof fetch;

    await createPayPalOrderRequest({
      config,
      paymentId: 'payment-1',
      amount: '10.00',
      currency: 'USD',
      credits: 5,
      fetchImpl: fetchMock,
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const tokenInit = vi.mocked(fetchMock).mock.calls[0][1] as RequestInit;
    const orderInit = vi.mocked(fetchMock).mock.calls[1][1] as RequestInit;
    const orderBody = JSON.parse(String(orderInit.body)) as Record<string, unknown>;
    expect((tokenInit.headers as Record<string, string>).Authorization).toMatch(/^Basic /);
    expect((orderInit.headers as Record<string, string>).Authorization).toBe('Bearer server-access-token');
    expect(JSON.stringify(orderBody)).not.toContain(config.clientSecret);
    expect(orderBody).toMatchObject({
      intent: 'CAPTURE',
      purchase_units: [{
        custom_id: 'payment-1',
        amount: { currency_code: 'USD', value: '10.00' },
      }],
    });
  });

  test('requires all PayPal transmission headers and accepts only SUCCESS verification', async () => {
    expect(await verifyPayPalWebhookRequest({
      config,
      headers: new Headers(),
      webhookEvent: { id: 'WH-1' },
      fetchImpl: vi.fn() as unknown as typeof fetch,
    })).toBe(false);

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ access_token: 'server-access-token', expires_in: 3600 }))
      .mockResolvedValueOnce(jsonResponse({ verification_status: 'SUCCESS' })) as unknown as typeof fetch;
    const headers = new Headers({
      'paypal-transmission-id': 'transmission-1',
      'paypal-transmission-time': '2026-08-11T00:00:00Z',
      'paypal-transmission-sig': 'signature',
      'paypal-cert-url': 'https://api.paypal.com/cert.pem',
      'paypal-auth-algo': 'SHA256withRSA',
    });
    expect(await verifyPayPalWebhookRequest({
      config,
      headers,
      webhookEvent: { id: 'WH-1' },
      fetchImpl: fetchMock,
    })).toBe(true);
  });

  test('parses money exactly and accepts only HTTPS PayPal approval hosts', () => {
    expect(paypalAmountToCents('10.00')).toBe(1000);
    expect(paypalAmountToCents('10.1')).toBe(1010);
    expect(paypalAmountToCents('10.001')).toBeNull();
    expect(isSafePayPalApprovalUrl('https://www.sandbox.paypal.com/checkoutnow')).toBe(true);
    expect(isSafePayPalApprovalUrl('https://paypal.com.attacker.test/checkout')).toBe(false);
    expect(isSafePayPalApprovalUrl('http://paypal.com/checkout')).toBe(false);
  });

  test('distinguishes pending, failed, and unexpected capture states', () => {
    expect(classifyPayPalCaptureStatus('COMPLETED')).toBe('completed');
    expect(classifyPayPalCaptureStatus('PENDING')).toBe('pending');
    expect(classifyPayPalCaptureStatus('DECLINED')).toBe('failed');
    expect(classifyPayPalCaptureStatus('VOIDED')).toBe('failed');
    expect(classifyPayPalCaptureStatus('UNRECOGNIZED')).toBe('review');
  });

  test('resolves a refunded payment to its parent capture from PayPal HATEOAS links', () => {
    expect(extractPayPalRefundCaptureId({
      id: 'REFUND-1',
      links: [
        { rel: 'self', href: 'https://api-m.sandbox.paypal.com/v2/payments/refunds/REFUND-1' },
        { rel: 'up', href: 'https://api-m.sandbox.paypal.com/v2/payments/captures/CAPTURE-1' },
      ],
    })).toBe('CAPTURE-1');
    expect(extractPayPalRefundCaptureId({
      supplementary_data: { related_ids: { capture_id: 'CAPTURE-2' } },
      links: [],
    })).toBe('CAPTURE-2');
    expect(extractPayPalRefundCaptureId({
      links: [{ rel: 'up', href: 'https://api-m.sandbox.paypal.com/v2/checkout/orders/ORDER-1' }],
    })).toBeNull();
  });

  test('retries unprocessed webhook rows without racing an active worker', () => {
    const now = Date.UTC(2026, 7, 11, 12);
    expect(classifyPayPalWebhookReplay(null, now)).toBe('missing');
    expect(classifyPayPalWebhookReplay({
      status: 'received',
      createdAt: now - 1_000,
      processedAt: null,
    }, now)).toBe('busy');
    expect(classifyPayPalWebhookReplay({
      status: 'retrying',
      createdAt: now - 600_000,
      processedAt: now - 301_000,
    }, now)).toBe('reclaim');
    expect(classifyPayPalWebhookReplay({
      status: 'failed',
      createdAt: now - 1_000,
      processedAt: now - 500,
    }, now)).toBe('reclaim');
    expect(classifyPayPalWebhookReplay({
      status: 'processed',
      createdAt: now - 1_000,
      processedAt: now - 500,
    }, now)).toBe('duplicate');
  });
});

describe('PayPal security boundaries', () => {
  const source = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

  test('keeps webhook and return routes public while protecting order creation with auth', () => {
    const middleware = source('src/middleware.ts');
    const orders = source('src/app/api/support/paypal/orders/route.ts');
    const webhook = source('src/app/api/support/paypal/webhook/route.ts');
    expect(middleware).toContain("'/api/support/paypal/webhook'");
    expect(middleware).toContain("'/api/support/paypal/return'");
    expect(middleware).toContain('!isVerifiedProviderCallback');
    expect(orders).toContain('requireAuthContext(request, { requireNonAnonymous: true })');
    expect(orders).toContain('expectedAmountUsd: body.amountUsd');
    expect(orders).toContain('expectedCredits: body.credits');
    expect(webhook).toContain('request.body.getReader()');
    expect(webhook).not.toContain('request.text()');
  });

  test('does not persist raw webhooks or PayPal payer personal information', () => {
    const payments = source('src/lib/server/paypal/payments.ts');
    const sqliteSchema = source('src/db/schema_sqlite.ts');
    const postgresSchema = source('src/db/schema_postgres.ts');
    for (const schema of [sqliteSchema, postgresSchema]) {
      expect(schema).not.toMatch(/payer_(?:email|name|address)/i);
      expect(schema).not.toContain("raw_payload");
    }
    expect(payments).not.toContain('webhookEvent: JSON.stringify');
    expect(payments).not.toContain('approvalUrl: approvalUrl');
    expect(payments).not.toContain('serverLogger.info({ approvalUrl');
  });

  test('uses stable idempotency references for grants and reversals', () => {
    const payments = source('src/lib/server/paypal/payments.ts');
    const quota = source('src/lib/server/access/audiobook-quota.ts');
    expect(payments).toContain('paypal-capture:${capture.captureId}');
    expect(payments).toContain('paypal-reversal:${payment.id}');
    expect(payments).toContain("status: 'deferred'");
    expect(payments).toContain('reconcileDeferredReversals');
    expect(payments).toContain('captureId: paypalWebhookEvents.captureId');
    expect(payments).toContain('return task(tx)');
    expect(payments).toContain('reserveSupportPayment');
    expect(payments).toContain('paypal-checkout:${input.userId}');
    expect(payments).toContain("'support_package_changed'");
    expect(payments).toContain("eventType === 'PAYMENT.CAPTURE.DENIED'");
    expect(payments).toContain("'webhook_processing'");
    expect(quota).toContain('pg_advisory_xact_lock');
    expect(quota).toContain('ledger.revocations.find((entry) => entry.id === input.id)');
  });

  test('does not advertise checkout to anonymous reader sessions', () => {
    const quotaRoute = source('src/app/api/audiobooks/quota/route.ts');
    const queueRoute = source('src/app/api/audiobooks/queue/route.ts');
    expect(quotaRoute).toContain('paypal.enabled && !ctx.user?.isAnonymous');
    expect(queueRoute).toContain('paypal.enabled && !ctxOrRes.user?.isAnonymous');
  });

  test('preserves only a validated PayPal return when sign-in is required', () => {
    const returnRoute = source('src/app/api/support/paypal/return/route.ts');
    const signIn = source('src/app/(app)/signin/page.tsx');
    expect(returnRoute).toContain("'callbackURL',");
    expect(signIn).toContain("url.pathname !== '/api/support/paypal/return'");
    expect(signIn).toContain('window.location.href = callbackURL');
    expect(signIn).toContain('callbackURL,');
  });
});
