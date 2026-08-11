export type MonthlyAudiobookQuotaProblem = {
  code?: unknown;
  freeLimit?: unknown;
  supportServerUrl?: unknown;
  supportMinimumUsd?: unknown;
  supportExtraAudiobooks?: unknown;
};

export const AUDIOBOOK_QUOTA_UPDATED_EVENT = 'openreader:audiobook-quota-updated';

export type AudiobookQuotaSnapshot = {
  unlimited: boolean;
  used: number;
  freeLimit: number;
  freeUsed: number;
  freeRemaining: number;
  supportCreditsRemaining: number;
  totalRemaining: number;
  resetTimeMs: number;
  supportServerUrl: string | null;
  supportMinimumUsd: number;
  supportExtraAudiobooks: number;
};

export function isMonthlyAudiobookQuotaProblem(value: unknown): value is MonthlyAudiobookQuotaProblem {
  return Boolean(
    value
    && typeof value === 'object'
    && (value as MonthlyAudiobookQuotaProblem).code === 'MONTHLY_AUDIOBOOK_QUOTA_EXCEEDED',
  );
}
export function formatMonthlyAudiobookQuotaMessage(problem: MonthlyAudiobookQuotaProblem): string {
  const freeLimit = Number(problem.freeLimit ?? 2);
  const minimumUsd = Number(problem.supportMinimumUsd ?? 10);
  const extraBooks = Number(problem.supportExtraAudiobooks ?? 5);
  const supportUrl = typeof problem.supportServerUrl === 'string' ? problem.supportServerUrl.trim() : '';
  const base = `You’ve used your ${freeLimit} free audiobook${freeLimit === 1 ? '' : 's'} this month. To help cover server and AI costs, support the server with a minimum $${minimumUsd}; that covers ${extraBooks} extra audiobook${extraBooks === 1 ? '' : 's'}.`;
  return supportUrl ? `${base} Support link: ${supportUrl}` : base;
}
