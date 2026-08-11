import type { PayPalConfig } from './config';

const PAYPAL_TIMEOUT_MS = 20_000;
const TOKEN_EXPIRY_SKEW_MS = 60_000;

type FetchLike = typeof fetch;

type AccessTokenResponse = {
  access_token?: unknown;
  expires_in?: unknown;
};

type CachedToken = {
  cacheKey: string;
  accessToken: string;
  expiresAt: number;
};

let cachedToken: CachedToken | null = null;

export class PayPalApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly debugId: string | null;

  constructor(input: { status: number; code?: string; debugId?: string | null }) {
    const code = input.code?.trim().slice(0, 100) || 'PAYPAL_API_ERROR';
    super(`PayPal request failed (${input.status}, ${code}).`);
    this.name = 'PayPalApiError';
    this.status = input.status;
    this.code = code;
    this.debugId = input.debugId?.trim().slice(0, 100) || null;
  }
}

async function fetchWithTimeout(
  fetchImpl: FetchLike,
  input: string,
  init: RequestInit,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PAYPAL_TIMEOUT_MS);
  try {
    return await fetchImpl(input, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function apiErrorFromBody(status: number, body: unknown): PayPalApiError {
  const rec = body && typeof body === 'object' && !Array.isArray(body)
    ? body as Record<string, unknown>
    : {};
  const details = Array.isArray(rec.details) ? rec.details : [];
  const firstDetail = details.find((detail) => detail && typeof detail === 'object') as Record<string, unknown> | undefined;
  return new PayPalApiError({
    status,
    code: typeof firstDetail?.issue === 'string'
      ? firstDetail.issue
      : typeof rec.name === 'string'
        ? rec.name
      : typeof rec.error === 'string'
        ? rec.error
        : undefined,
    debugId: typeof rec.debug_id === 'string' ? rec.debug_id : null,
  });
}

async function getAccessToken(config: PayPalConfig, fetchImpl: FetchLike): Promise<string> {
  const cacheKey = `${config.environment}:${config.clientId}`;
  if (cachedToken?.cacheKey === cacheKey && cachedToken.expiresAt > Date.now() + TOKEN_EXPIRY_SKEW_MS) {
    return cachedToken.accessToken;
  }

  const response = await fetchWithTimeout(fetchImpl, `${config.apiBaseUrl}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      Authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  const body = await response.json().catch(() => ({})) as AccessTokenResponse;
  if (!response.ok) throw apiErrorFromBody(response.status, body);
  if (typeof body.access_token !== 'string' || !body.access_token.trim()) {
    throw new PayPalApiError({ status: 502, code: 'MISSING_ACCESS_TOKEN' });
  }
  const expiresIn = Math.max(60, Number(body.expires_in ?? 300));
  cachedToken = {
    cacheKey,
    accessToken: body.access_token,
    expiresAt: Date.now() + (Number.isFinite(expiresIn) ? expiresIn : 300) * 1000,
  };
  return body.access_token;
}

async function paypalJsonRequest<T>(input: {
  config: PayPalConfig;
  path: string;
  method: 'POST' | 'GET';
  body?: unknown;
  requestId?: string;
  fetchImpl?: FetchLike;
}): Promise<T> {
  const fetchImpl = input.fetchImpl || fetch;
  const accessToken = await getAccessToken(input.config, fetchImpl);
  const response = await fetchWithTimeout(fetchImpl, `${input.config.apiBaseUrl}${input.path}`, {
    method: input.method,
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...(input.requestId ? { 'PayPal-Request-Id': input.requestId } : {}),
    },
    ...(input.body === undefined ? {} : { body: JSON.stringify(input.body) }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401) cachedToken = null;
    throw apiErrorFromBody(response.status, body);
  }
  return body as T;
}

export type PayPalLink = {
  href?: unknown;
  rel?: unknown;
  method?: unknown;
};

export type PayPalOrderResponse = {
  id?: unknown;
  status?: unknown;
  links?: PayPalLink[];
  purchase_units?: unknown;
};

export async function createPayPalOrderRequest(input: {
  config: PayPalConfig;
  paymentId: string;
  amount: string;
  currency: 'USD';
  credits: number;
  fetchImpl?: FetchLike;
}): Promise<PayPalOrderResponse> {
  return paypalJsonRequest<PayPalOrderResponse>({
    config: input.config,
    path: '/v2/checkout/orders',
    method: 'POST',
    requestId: `${input.paymentId}-create`,
    fetchImpl: input.fetchImpl,
    body: {
      intent: 'CAPTURE',
      purchase_units: [{
        reference_id: 'openreader-support-credits',
        description: `${input.credits} OpenReader audiobook credits`,
        custom_id: input.paymentId,
        invoice_id: `openreader-${input.paymentId}`,
        amount: {
          currency_code: input.currency,
          value: input.amount,
        },
      }],
      payment_source: {
        paypal: {
          experience_context: {
            brand_name: 'OpenReader',
            landing_page: 'LOGIN',
            shipping_preference: 'NO_SHIPPING',
            user_action: 'PAY_NOW',
            return_url: `${input.config.siteOrigin}/api/support/paypal/return`,
            cancel_url: `${input.config.siteOrigin}/app?paypal=cancelled`,
          },
        },
      },
    },
  });
}

export async function capturePayPalOrderRequest(input: {
  config: PayPalConfig;
  paymentId: string;
  orderId: string;
  fetchImpl?: FetchLike;
}): Promise<PayPalOrderResponse> {
  return paypalJsonRequest<PayPalOrderResponse>({
    config: input.config,
    path: `/v2/checkout/orders/${encodeURIComponent(input.orderId)}/capture`,
    method: 'POST',
    requestId: `${input.paymentId}-capture`,
    fetchImpl: input.fetchImpl,
  });
}

export async function getPayPalOrderRequest(input: {
  config: PayPalConfig;
  orderId: string;
  fetchImpl?: FetchLike;
}): Promise<PayPalOrderResponse> {
  return paypalJsonRequest<PayPalOrderResponse>({
    config: input.config,
    path: `/v2/checkout/orders/${encodeURIComponent(input.orderId)}`,
    method: 'GET',
    fetchImpl: input.fetchImpl,
  });
}

export async function verifyPayPalWebhookRequest(input: {
  config: PayPalConfig;
  headers: Headers;
  webhookEvent: unknown;
  fetchImpl?: FetchLike;
}): Promise<boolean> {
  const transmissionId = input.headers.get('paypal-transmission-id')?.trim();
  const transmissionTime = input.headers.get('paypal-transmission-time')?.trim();
  const transmissionSig = input.headers.get('paypal-transmission-sig')?.trim();
  const certUrl = input.headers.get('paypal-cert-url')?.trim();
  const authAlgo = input.headers.get('paypal-auth-algo')?.trim();
  if (!transmissionId || !transmissionTime || !transmissionSig || !certUrl || !authAlgo) return false;

  const result = await paypalJsonRequest<{ verification_status?: unknown }>({
    config: input.config,
    path: '/v1/notifications/verify-webhook-signature',
    method: 'POST',
    fetchImpl: input.fetchImpl,
    body: {
      transmission_id: transmissionId,
      transmission_time: transmissionTime,
      cert_url: certUrl,
      auth_algo: authAlgo,
      transmission_sig: transmissionSig,
      webhook_id: input.config.webhookId,
      webhook_event: input.webhookEvent,
    },
  });
  return result.verification_status === 'SUCCESS';
}

export function resetPayPalClientCacheForTests(): void {
  cachedToken = null;
}
