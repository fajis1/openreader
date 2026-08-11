'use client';

import { useEffect, useState } from 'react';
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
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [paymentNotice, setPaymentNotice] = useState<string | null>(null);
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

  useEffect(() => {
    const url = new URL(window.location.href);
    const status = url.searchParams.get('paypal');
    const messages: Record<string, string> = {
      success: 'Payment received. Your support credits are ready.',
      pending: 'PayPal is still confirming the payment. Credits will appear automatically.',
      cancelled: 'PayPal checkout was cancelled; no charge was made.',
      error: 'PayPal could not confirm the payment. No credits were added; please try again or contact support.',
    };
    if (!status || !messages[status]) return;
    setPaymentNotice(messages[status]);
    url.searchParams.delete('paypal');
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
    if (status === 'success' || status === 'pending') void mutate();
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

  const startPayPalCheckout = async () => {
    setCheckoutLoading(true);
    setCheckoutError(null);
    try {
      const response = await fetch('/api/support/paypal/orders', {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amountUsd: data.supportMinimumUsd,
          credits: data.supportExtraAudiobooks,
        }),
      });
      const result = await response.json().catch(() => ({})) as {
        approvalUrl?: string;
        error?: string;
        code?: string;
      };
      if (!response.ok || !result.approvalUrl) {
        if (result.code === 'support_package_changed') void mutate();
        throw new Error(result.error || 'Unable to start PayPal checkout.');
      }
      const approvalUrl = new URL(result.approvalUrl);
      if (
        approvalUrl.protocol !== 'https:'
        || !(approvalUrl.hostname === 'paypal.com' || approvalUrl.hostname.endsWith('.paypal.com'))
      ) {
        throw new Error('PayPal returned an invalid checkout address.');
      }
      window.location.assign(approvalUrl.toString());
    } catch (checkoutFailure) {
      setCheckoutError(checkoutFailure instanceof Error
        ? checkoutFailure.message
        : 'Unable to start PayPal checkout.');
      setCheckoutLoading(false);
    }
  };

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

      {paymentNotice ? (
        <p className="mt-1.5 rounded border border-accent-line bg-accent-wash px-1.5 py-1 text-[10px] text-foreground" role="status">
          {paymentNotice}
        </p>
      ) : null}
      {checkoutError ? (
        <p className="mt-1.5 text-[10px] text-danger" role="alert">{checkoutError}</p>
      ) : null}

      {data.paypalEnabled ? (
        <button
          type="button"
          onClick={startPayPalCheckout}
          disabled={checkoutLoading}
          className="mt-1.5 inline-flex w-full items-center justify-center rounded-md bg-accent px-2 py-1.5 text-[10px] font-semibold text-white hover:opacity-90 disabled:cursor-wait disabled:opacity-60"
        >
          {checkoutLoading
            ? 'Opening PayPal…'
            : `Support $${data.supportMinimumUsd} · add ${data.supportExtraAudiobooks} books`}
        </button>
      ) : null}

      {data.supportServerUrl && (
        <a
          href={data.supportServerUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-1.5 inline-flex text-[10px] font-medium text-accent hover:underline"
        >
          {data.paypalEnabled
            ? 'Other support options →'
            : `Support $${data.supportMinimumUsd} for ${data.supportExtraAudiobooks} more →`}
        </a>
      )}
    </section>
  );
}
