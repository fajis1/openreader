import { serverLogger } from '@/lib/server/logger';

const BACKUP_ELIGIBLE_STATUSES = new Set([429, 503]);
const MAX_ATTEMPTS = 8;
const INITIAL_DELAY_MS = 4000;
const MAX_DELAY_MS = 300000; // 5 minutes

export const GEMINI_MODEL_FALLBACKS: Readonly<Record<string, readonly string[]>> = {
  'gemini-3.7-flash': ['gemini-3.6-flash', 'gemini-3.5-flash'],
  'gemini-3.6-flash': ['gemini-3.5-flash'],
  'gemini-3.5-flash': ['gemini-2.5-flash'],
  'gemini-3.5-flash-lite': ['gemini-3.1-flash-lite'],
};

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
  requestedModel?: string;
  request: (apiKey: string, model?: string) => Promise<Response>;
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

      if (response.status === 429) {
        try {
          const bodyStr = await response.clone().text();
          const lowerBody = bodyStr.toLowerCase();
          if (lowerBody.includes('quota') || lowerBody.includes('spending cap') || lowerBody.includes('billing')) {
            return response;
          }
        } catch {
          // ignore
        }
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
      }, 'Retrying Gemini request after a transient HTTP response');

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
      }, 'Retrying Gemini request after a network error');

      if (onStatusUpdate) {
        await onStatusUpdate(msg);
      }
    }
    await sleep(delayMs);
    delayMs = Math.min(delayMs * 2, MAX_DELAY_MS);
  }
  return request(apiKey);
}

async function fetchGeminiWithKeyFallback(
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
  }, 'Switching to the backup Gemini API key');

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

export async function isGeminiModelUnavailableResponse(response: Response): Promise<boolean> {
  if (response.ok || (response.status !== 400 && response.status !== 404)) return false;
  const body = await response.clone().text().catch(() => '');
  const normalized = body.toLowerCase();
  if (response.status === 404 && normalized.length === 0) return true;
  return normalized.includes('model_not_found')
    || normalized.includes('model not found')
    || normalized.includes('model does not exist')
    || normalized.includes('model is not available')
    || normalized.includes('model is not supported')
    || normalized.includes('unsupported model')
    || /models?\/[\w.-]+[^\n]{0,120}(?:not found|not supported|not available)/i.test(body);
}

type GeminiModelFallbackReason = 'unavailable' | 'overloaded';

async function getGeminiModelFallbackReason(
  response: Response,
): Promise<GeminiModelFallbackReason | null> {
  // A 503 only reaches this point after the retry and backup-key policy for the
  // current model has been exhausted, so it represents sustained overload for
  // this request rather than a single transient response.
  if (response.status === 503) return 'overloaded';
  if (await isGeminiModelUnavailableResponse(response)) return 'unavailable';
  return null;
}

export async function fetchGeminiWithRateLimitFallback(
  input: GeminiFallbackOptions,
): Promise<{
  response: Response;
  usedBackup: boolean;
  requestedModel?: string;
  usedModel?: string;
  usedModelFallback: boolean;
}> {
  const requestedModel = input.requestedModel?.trim() || undefined;
  const models: Array<string | undefined> = requestedModel
    ? [requestedModel, ...(GEMINI_MODEL_FALLBACKS[requestedModel] || [])]
    : [undefined];
  let lastResult: { response: Response; usedBackup: boolean } | null = null;

  for (const candidateModel of models) {
    const result = await fetchGeminiWithKeyFallback({
      ...input,
      request: (apiKey) => candidateModel
        ? input.request(apiKey, candidateModel)
        : input.request(apiKey),
    });
    lastResult = result;
    const fallbackReason = await getGeminiModelFallbackReason(result.response);
    if (!fallbackReason) {
      return {
        ...result,
        requestedModel,
        usedModel: candidateModel,
        usedModelFallback: Boolean(requestedModel && candidateModel !== requestedModel),
      };
    }

    const nextIndex = models.indexOf(candidateModel) + 1;
    const nextModel = models[nextIndex];
    if (!nextModel) break;
    const statusMessage = fallbackReason === 'overloaded'
      ? `${candidateModel} remained overloaded after retries. Using ${nextModel} for this request.`
      : `${candidateModel} is unavailable for this Gemini API project. Using ${nextModel} for this request.`;
    if (fallbackReason === 'overloaded') {
      serverLogger.warn({
        event: 'gemini.model.fallback',
        requestedModel,
        overloadedModel: candidateModel,
        fallbackModel: nextModel,
        httpStatus: result.response.status,
        reason: fallbackReason,
      }, 'Falling back from an overloaded Gemini model');
    } else {
      serverLogger.warn({
        event: 'gemini.model.fallback',
        requestedModel,
        unavailableModel: candidateModel,
        fallbackModel: nextModel,
        httpStatus: result.response.status,
        reason: fallbackReason,
      }, 'Falling back from an unavailable Gemini model');
    }
    await input.onStatusUpdate?.(statusMessage);
  }

  return {
    response: lastResult?.response || new Response(null, { status: 502 }),
    usedBackup: lastResult?.usedBackup || false,
    requestedModel,
    usedModel: models.at(-1),
    usedModelFallback: models.length > 1,
  };
}
