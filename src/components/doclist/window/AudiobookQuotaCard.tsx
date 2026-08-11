'use client';

import { useEffect } from 'react';
import useSWR from 'swr';
import {
  AUDIOBOOK_QUOTA_UPDATED_EVENT,
  type AudiobookQuotaSnapshot,
} from '@/lib/shared/audiobook-quota';

async function fetchQuota(url: string): Promise<AudiobookQuotaSnapshot> {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error('Unable to load audiobook allowance');
  return response.json() as Promise<AudiobookQuotaSnapshot>;
}

function pluralBooks(value: number): string {
  return value === 1 ? 'book' : 'books';
}

export function AudiobookQuotaCard() {
  const { data, error, isLoading, mutate } = useSWR<AudiobookQuotaSnapshot>(
    '/api/audiobooks/quota',
    fetchQuota,
    { refreshInterval: 60_000, revalidateOnFocus: true },
  );

  useEffect(() => {
    const refresh = () => { void mutate(); };
    window.addEventListener(AUDIOBOOK_QUOTA_UPDATED_EVENT, refresh);
    return () => window.removeEventListener(AUDIOBOOK_QUOTA_UPDATED_EVENT, refresh);
  }, [mutate]);

  if (error) return null;

  if (isLoading || !data) {
    return (
      <section
        aria-label="Monthly audiobook allowance"
        className="rounded-lg border border-line-soft bg-surface-sunken px-2.5 py-2"
      >
        <p className="text-[10px] font-semibold uppercase tracking-wide text-soft">Monthly audiobooks</p>
        <div className="mt-1.5 h-3 w-24 animate-pulse rounded bg-surface-raised" />
      </section>
    );
  }

  if (data.unlimited) {
    return (
      <section
        aria-label="Monthly audiobook allowance"
        className="rounded-lg border border-line-soft bg-surface-sunken px-2.5 py-2"
      >
        <p className="text-[10px] font-semibold uppercase tracking-wide text-soft">Monthly audiobooks</p>
        <p className="mt-0.5 text-sm font-semibold text-foreground">Unlimited</p>
        <p className="text-[10px] text-soft">Administrator account</p>
      </section>
    );
  }

  const freeProgress = data.freeLimit > 0
    ? Math.min(100, Math.max(0, (data.freeUsed / data.freeLimit) * 100))
    : 100;
  const resetLabel = new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(data.resetTimeMs));

  return (
    <section
      aria-label="Monthly audiobook allowance"
      className="rounded-lg border border-line-soft bg-surface-sunken px-2.5 py-2"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-soft">Monthly audiobooks</p>
          <p className="mt-0.5 text-sm font-semibold text-foreground">
            {data.freeRemaining} free {pluralBooks(data.freeRemaining)} left
          </p>
        </div>
        <span
          className="shrink-0 rounded-full bg-accent-wash px-1.5 py-0.5 text-[10px] font-semibold text-accent"
          title="Support credits do not expire at the monthly reset"
        >
          +{data.supportCreditsRemaining}
        </span>
      </div>

      <div
        className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-raised"
        role="progressbar"
        aria-label="Free monthly audiobooks used"
        aria-valuemin={0}
        aria-valuemax={data.freeLimit}
        aria-valuenow={data.freeUsed}
      >
        <div className="h-full rounded-full bg-accent" style={{ width: `${freeProgress}%` }} />
      </div>

      <div className="mt-1.5 flex flex-wrap items-center justify-between gap-x-2 text-[10px] text-soft">
        <span>{data.supportCreditsRemaining} support {data.supportCreditsRemaining === 1 ? 'credit' : 'credits'}</span>
        <span>Resets {resetLabel} UTC</span>
      </div>
      <p
        className="mt-1 text-[10px] text-soft"
        title="Resetting and fully rerecording a book with new settings uses another allowance."
      >
        Chapter repairs and retries are included.
      </p>

      {data.supportServerUrl && (
        <a
          href={data.supportServerUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-1.5 inline-flex text-[10px] font-medium text-accent hover:underline"
        >
          Support ${data.supportMinimumUsd} for {data.supportExtraAudiobooks} more →
        </a>
      )}
    </section>
  );
}
