export const GEMINI_RATE_LIMIT_PAUSE_MESSAGE =
  'Gemini API limits paused this audiobook. Completed chapters are preserved, and OpenReader will retry automatically when API capacity becomes available.';

export const AUDIOBOOK_ADMIN_PAUSE_REQUESTED_STATUS = 'pausing';

export function isGeminiRateLimitPause(error: string | null | undefined): boolean {
  return error === GEMINI_RATE_LIMIT_PAUSE_MESSAGE;
}
