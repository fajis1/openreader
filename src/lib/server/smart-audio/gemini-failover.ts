import { serverLogger } from '@/lib/server/logger';

const BACKUP_ELIGIBLE_STATUSES = new Set([429, 503]);
const MAX_ATTEMPTS = 8;
const INITIAL_DELAY_MS = 4000;
const MAX_DELAY_MS = 300000; // 5 minutes

const sleep = (ms: number) => new Promise((resolve) => {
  if (process.env.NODE_ENV === 'test') {
    resolve(undefined);
  } else {
    setTimeout(resolve, ms);
  }
});

export interface GeminiFallbackOptions {
  primaryApiKey: string;
  backupApiKey?: string | null;
  request: (apiKey: string) => Promise<Response>;
  onStatusUpdate?: (statusMessage: string) => Promise<void> | void;
  initialDelayMs?: number;
}

async function fetchWithExponentialBackoff(
  apiKey: string,
  keyType: 'primary' | 'backup',
  request: (apiKey: string) => Promise<Response>,
  onStatusUpdate?: (statusMessage: string) => Promise<void> | void,
  customInitialDelayMs?: number,
): Promise<Response> {
  let delayMs = customInitialDelayMs ?? INITIAL_DELAY_MS;
  const maskedKey = apiKey.length >= 4 ? `...${apiKey.slice(-4)}` : 'Key';

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await request(apiKey);
      if (!BACKUP_ELIGIBLE_STATUSES.has(response.status) || attempt === MAX_ATTEMPTS) {
        return response;
      }

      const statusText = response.status === 429 ? 'rate-limited (HTTP 429)' : 'temporarily unavailable (HTTP 503)';
      const delaySeconds = Math.round(delayMs / 1000);
      const msg = `Gemini API ${statusText}. Retrying ${keyType} key (${maskedKey}) in ${delaySeconds}s (Attempt ${attempt}/${MAX_ATTEMPTS})...`;

      serverLogger.warn({
        event: 'gemini.rate_limit.retry',
        keyType,
        maskedKey,
        httpStatus: response.status,
        attempt,
        maxAttempts: MAX_ATTEMPTS,
        nextDelaySeconds: delaySeconds,
      }, msg);

      if (onStatusUpdate) {
        await onStatusUpdate(msg);
      }
    } catch (error) {
      if (attempt === MAX_ATTEMPTS) throw error;
      const delaySeconds = Math.round(delayMs / 1000);
      const msg = `Gemini network error. Retrying ${keyType} key (${maskedKey}) in ${delaySeconds}s (Attempt ${attempt}/${MAX_ATTEMPTS})...`;

      serverLogger.warn({
        event: 'gemini.network_error.retry',
        keyType,
        maskedKey,
        attempt,
        maxAttempts: MAX_ATTEMPTS,
        nextDelaySeconds: delaySeconds,
        error: error instanceof Error ? error.message : error,
      }, msg);

      if (onStatusUpdate) {
        await onStatusUpdate(msg);
      }
    }
    await sleep(delayMs);
    delayMs = Math.min(delayMs * 2, MAX_DELAY_MS);
  }
  return request(apiKey);
}

export async function fetchGeminiWithRateLimitFallback(
  input: GeminiFallbackOptions,
): Promise<{ response: Response; usedBackup: boolean }> {
  const primaryApiKey = input.primaryApiKey.trim();
  const backupApiKey = (input.backupApiKey || '').trim();

  const primaryResponse = await fetchWithExponentialBackoff(
    primaryApiKey,
    'primary',
    input.request,
    input.onStatusUpdate,
    input.initialDelayMs,
  );

  if (
    !BACKUP_ELIGIBLE_STATUSES.has(primaryResponse.status)
    || !backupApiKey
    || backupApiKey === primaryApiKey
  ) {
    return { response: primaryResponse, usedBackup: false };
  }

  const backupMasked = backupApiKey.length >= 4 ? `...${backupApiKey.slice(-4)}` : 'Key';
  const failoverMsg = `Primary Gemini key exhausted (HTTP ${primaryResponse.status}). Switching to Backup key (${backupMasked})...`;

  serverLogger.warn({
    event: 'gemini.failover.backup_key',
    primaryHttpStatus: primaryResponse.status,
    backupMasked,
  }, failoverMsg);

  if (input.onStatusUpdate) {
    await input.onStatusUpdate(failoverMsg);
  }

  const backupResponse = await fetchWithExponentialBackoff(
    backupApiKey,
    'backup',
    input.request,
    input.onStatusUpdate,
    input.initialDelayMs,
  );

  return {
    response: backupResponse,
    usedBackup: true,
  };
}
