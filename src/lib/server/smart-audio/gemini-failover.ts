const BACKUP_ELIGIBLE_STATUSES = new Set([429, 503]);
const MAX_ATTEMPTS = 8;
const INITIAL_DELAY_MS = 4000;
const MAX_DELAY_MS = 300000; // 5 minutes

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchWithExponentialBackoff(
  apiKey: string,
  request: (apiKey: string) => Promise<Response>,
): Promise<Response> {
  let delayMs = INITIAL_DELAY_MS;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await request(apiKey);
      if (!BACKUP_ELIGIBLE_STATUSES.has(response.status) || attempt === MAX_ATTEMPTS) {
        return response;
      }
    } catch (error) {
      if (attempt === MAX_ATTEMPTS) throw error;
    }
    await sleep(delayMs);
    delayMs = Math.min(delayMs * 2, MAX_DELAY_MS);
  }
  return request(apiKey);
}

export async function fetchGeminiWithRateLimitFallback(input: {
  primaryApiKey: string;
  backupApiKey?: string | null;
  request: (apiKey: string) => Promise<Response>;
}): Promise<{ response: Response; usedBackup: boolean }> {
  const primaryApiKey = input.primaryApiKey.trim();
  const backupApiKey = (input.backupApiKey || '').trim();

  const primaryResponse = await fetchWithExponentialBackoff(primaryApiKey, input.request);
  if (
    !BACKUP_ELIGIBLE_STATUSES.has(primaryResponse.status)
    || !backupApiKey
    || backupApiKey === primaryApiKey
  ) {
    return { response: primaryResponse, usedBackup: false };
  }

  const backupResponse = await fetchWithExponentialBackoff(backupApiKey, input.request);
  return {
    response: backupResponse,
    usedBackup: true,
  };
}
