const BACKUP_ELIGIBLE_STATUSES = new Set([429, 503]);

export async function fetchGeminiWithRateLimitFallback(input: {
  primaryApiKey: string;
  backupApiKey?: string | null;
  request: (apiKey: string) => Promise<Response>;
}): Promise<{ response: Response; usedBackup: boolean }> {
  const primaryApiKey = input.primaryApiKey.trim();
  const backupApiKey = (input.backupApiKey || '').trim();
  const primaryResponse = await input.request(primaryApiKey);
  if (
    !BACKUP_ELIGIBLE_STATUSES.has(primaryResponse.status)
    || !backupApiKey
    || backupApiKey === primaryApiKey
  ) {
    return { response: primaryResponse, usedBackup: false };
  }

  return {
    response: await input.request(backupApiKey),
    usedBackup: true,
  };
}
