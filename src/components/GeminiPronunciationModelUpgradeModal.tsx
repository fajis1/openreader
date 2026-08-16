'use client';

import { useEffect, useState } from 'react';

import { ModalFrame } from '@/components/ui';

type UpgradeOffer = {
  available: boolean;
  affectedProfileCount: number;
  fromModel: string;
  toModel: string;
};

export function GeminiPronunciationModelUpgradeModal({
  onResolved,
}: {
  onResolved: () => void;
}) {
  const [offer, setOffer] = useState<UpgradeOffer | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    fetch('/api/tts-settings')
      .then(async (response) => {
        if (!response.ok) throw new Error('Could not check Gemini model updates.');
        return response.json();
      })
      .then((result) => {
        if (cancelled) return;
        const next = result.pronunciationModelUpgrade as UpgradeOffer | undefined;
        if (!next?.available) {
          onResolved();
          return;
        }
        setOffer(next);
      })
      .catch(() => {
        if (!cancelled) onResolved();
      });
    return () => { cancelled = true; };
  }, [onResolved]);

  const choose = async (decision: 'upgrade' | 'stay') => {
    if (isSaving) return;
    setIsSaving(true);
    setError('');
    try {
      const response = await fetch('/api/tts-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pronunciationModelUpgradeDecision: decision }),
      });
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        throw new Error(result.error || 'Could not save your model choice.');
      }
      onResolved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save your model choice.');
    } finally {
      setIsSaving(false);
    }
  };

  if (!offer) return null;
  const profileLabel = offer.affectedProfileCount === 1 ? 'profile' : 'profiles';

  return (
    <ModalFrame open onClose={() => undefined}>
      <div className="w-[min(92vw,34rem)] bg-surface p-6 text-foreground">
        <h2 className="text-xl font-bold">Gemini 3.7 Flash is available</h2>
        <p className="mt-3 text-sm text-soft">
          You currently use Gemini 3.6 Flash for pronunciation work in{' '}
          {offer.affectedProfileCount} {profileLabel}. Upgrade those profiles to Gemini 3.7 Flash,
          or keep 3.6 if you prefer it.
        </p>
        <p className="mt-2 text-sm text-soft">
          New profiles will default to 3.7. This choice only changes the pronunciation model;
          your prompts, API keys, pronunciations, and cleanup model stay unchanged.
        </p>
        {error ? <p className="mt-3 text-sm text-danger">{error}</p> : null}
        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            disabled={isSaving}
            onClick={() => void choose('stay')}
            className="rounded border border-line px-4 py-2 text-sm hover:bg-surface-raised disabled:opacity-50"
          >
            Stay on 3.6
          </button>
          <button
            type="button"
            disabled={isSaving}
            onClick={() => void choose('upgrade')}
            className="rounded bg-accent px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
          >
            {isSaving ? 'Saving…' : 'Upgrade to 3.7'}
          </button>
        </div>
      </div>
    </ModalFrame>
  );
}
