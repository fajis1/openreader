import { tryGetOrigin } from '@/lib/shared/urls';

export type PayPalEnvironment = 'sandbox' | 'live';

export type PayPalConfig = {
  environment: PayPalEnvironment;
  apiBaseUrl: string;
  clientId: string;
  clientSecret: string;
  webhookId: string;
  merchantId: string | null;
  siteOrigin: string;
};

export type PayPalReadiness = {
  enabled: boolean;
  environment: PayPalEnvironment;
  credentialsConfigured: boolean;
  webhookConfigured: boolean;
  siteOriginConfigured: boolean;
  liveHttpsReady: boolean;
};

function environmentFromEnv(): PayPalEnvironment {
  return process.env.PAYPAL_ENV?.trim().toLowerCase() === 'live' ? 'live' : 'sandbox';
}

export function getPayPalReadiness(): PayPalReadiness {
  const environment = environmentFromEnv();
  const siteOrigin = tryGetOrigin(process.env.BASE_URL);
  const credentialsConfigured = Boolean(
    process.env.PAYPAL_CLIENT_ID?.trim()
    && process.env.PAYPAL_CLIENT_SECRET?.trim(),
  );
  const webhookConfigured = Boolean(process.env.PAYPAL_WEBHOOK_ID?.trim());
  const liveHttpsReady = environment !== 'live' || siteOrigin?.startsWith('https://') === true;
  return {
    enabled: credentialsConfigured && webhookConfigured && Boolean(siteOrigin) && liveHttpsReady,
    environment,
    credentialsConfigured,
    webhookConfigured,
    siteOriginConfigured: Boolean(siteOrigin),
    liveHttpsReady,
  };
}

export function getPayPalConfig(): PayPalConfig {
  const readiness = getPayPalReadiness();
  if (!readiness.credentialsConfigured) {
    throw new Error('PayPal checkout is not configured. Add the PayPal client ID and secret.');
  }
  if (!readiness.webhookConfigured) {
    throw new Error('PayPal checkout is not configured. Add the PayPal webhook ID.');
  }
  const siteOrigin = tryGetOrigin(process.env.BASE_URL);
  if (!siteOrigin) throw new Error('PayPal checkout requires a valid BASE_URL.');
  if (!readiness.liveHttpsReady) throw new Error('Live PayPal checkout requires an HTTPS BASE_URL.');

  const environment = readiness.environment;
  return {
    environment,
    apiBaseUrl: environment === 'live'
      ? 'https://api-m.paypal.com'
      : 'https://api-m.sandbox.paypal.com',
    clientId: process.env.PAYPAL_CLIENT_ID!.trim(),
    clientSecret: process.env.PAYPAL_CLIENT_SECRET!.trim(),
    webhookId: process.env.PAYPAL_WEBHOOK_ID!.trim(),
    merchantId: process.env.PAYPAL_MERCHANT_ID?.trim() || null,
    siteOrigin,
  };
}
