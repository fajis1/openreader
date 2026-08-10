'use client';

import { useEffect, useState } from 'react';

import { ModalFrame } from '@/components/ui';

type DictionaryReleaseUpdate = {
  word: string;
  type: 'pronunciation' | 'definition' | 'pronunciation-removal' | 'definition-removal';
  status: 'new' | 'conflict' | 'remove' | 'deletion-conflict';
  git: string | null;
  local: string | null;
  gitChoices?: Array<{ phonetic: string }>;
  reasons?: string[];
  safeToApply: boolean;
};

type DictionaryReleaseResponse = {
  hash: string;
  isAdmin: boolean;
  updates: DictionaryReleaseUpdate[];
};

const updateId = (update: DictionaryReleaseUpdate) => `${update.type}:${update.word}`;

function updateLabel(update: DictionaryReleaseUpdate): string {
  if (update.type === 'pronunciation-removal') return 'Pronunciation removal';
  if (update.type === 'definition-removal') return 'Definition removal';
  return update.type === 'pronunciation' ? 'Pronunciation' : 'Definition';
}

function statusLabel(update: DictionaryReleaseUpdate): string {
  if (update.status === 'new') return 'New shared entry';
  if (update.status === 'conflict') return 'Local value differs';
  if (update.status === 'remove') return 'Unchanged malformed entry';
  return 'Locally modified; kept by default';
}

export function DictionaryUpdateModal() {
  const [data, setData] = useState<DictionaryReleaseResponse | null>(null);
  const [selectedUpdates, setSelectedUpdates] = useState<Set<string>>(new Set());
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    fetch('/api/tts/dictionary-updates')
      .then(async (response) => {
        if (!response.ok) throw new Error('Failed to check for dictionary updates.');
        return response.json();
      })
      .then((response) => {
        if (!response.hasUpdates) return;
        const next = response as DictionaryReleaseResponse;
        setData(next);
        setSelectedUpdates(new Set(
          next.updates.filter((update) => update.safeToApply).map(updateId),
        ));
      })
      .catch((error) => console.error('Failed to check for dictionary updates', error));
  }, []);

  const handleApply = async (dismissAll = false) => {
    if (!data || isSaving) return;
    setIsSaving(true);
    try {
      const selected = data.updates.filter((update) => selectedUpdates.has(updateId(update)));
      const response = await fetch('/api/tts/dictionary-updates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          hash: data.hash,
          selectedPronunciationWords: selected
            .filter((update) => update.type === 'pronunciation')
            .map((update) => update.word),
          selectedDefinitionWords: selected
            .filter((update) => update.type === 'definition')
            .map((update) => update.word),
          selectedPronunciationRemovals: selected
            .filter((update) => update.type === 'pronunciation-removal')
            .map((update) => update.word),
          selectedDefinitionRemovals: selected
            .filter((update) => update.type === 'definition-removal')
            .map((update) => update.word),
          dismissAll,
        }),
      });
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        throw new Error(result.error || 'Failed to apply dictionary updates.');
      }
      setData(null);
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Failed to apply dictionary updates.');
    } finally {
      setIsSaving(false);
    }
  };

  const safeUpdateIds = data
    ? data.updates.filter((update) => update.safeToApply).map(updateId)
    : [];
  const allUpdateIds = data ? data.updates.map(updateId) : [];

  const selectSafeUpdates = () => setSelectedUpdates(new Set(safeUpdateIds));
  const selectAllUpdates = () => {
    if (!data) return;
    const unsafeCount = data.updates.length - safeUpdateIds.length;
    if (
      unsafeCount > 0
      && !window.confirm(
        `Select all ${data.updates.length} updates? This includes ${unsafeCount} conflicting or locally modified ${unsafeCount === 1 ? 'value' : 'values'} and may replace reviewed local pronunciations or definitions.`,
      )
    ) return;
    setSelectedUpdates(new Set(allUpdateIds));
  };

  if (!data) return null;

  return (
    <ModalFrame open onClose={() => setData(null)}>
      <div className="flex max-h-[80vh] min-w-[700px] max-w-5xl flex-col bg-surface p-6 text-foreground">
        <h2 className="mb-2 text-xl font-bold">
          {data.isAdmin ? 'Shared Dictionary Update Available' : 'Personal Dictionary Update Available'}
        </h2>
        <p className="mb-4 text-sm text-soft">
          {data.isAdmin
            ? 'New entries and unchanged malformed entries are selected. Conflicting or locally modified values remain unselected unless you explicitly choose them.'
            : 'You can add new shared defaults to this profile and remove personal entries that exactly match retired malformed values. Modified personal entries remain unselected.'}
        </p>

        <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
          <button
            type="button"
            onClick={selectSafeUpdates}
            disabled={isSaving || safeUpdateIds.length === 0}
            className="rounded border border-line bg-surface px-3 py-1.5 text-foreground hover:bg-accent-wash disabled:opacity-50"
          >
            Select Safe ({safeUpdateIds.length})
          </button>
          <button
            type="button"
            onClick={selectAllUpdates}
            disabled={isSaving || allUpdateIds.length === 0 || selectedUpdates.size === allUpdateIds.length}
            className="rounded border border-warning bg-warning-wash px-3 py-1.5 text-warning hover:opacity-80 disabled:opacity-50"
          >
            Select All ({allUpdateIds.length})
          </button>
          <button
            type="button"
            onClick={() => setSelectedUpdates(new Set())}
            disabled={isSaving || selectedUpdates.size === 0}
            className="rounded border border-line bg-surface px-3 py-1.5 text-soft hover:bg-accent-wash hover:text-foreground disabled:opacity-50"
          >
            Clear All
          </button>
          <span className="ml-auto text-xs text-soft">
            {selectedUpdates.size} selected
          </span>
        </div>

        <div className="flex-1 overflow-auto rounded border border-line">
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 bg-surface-sunken">
              <tr>
                <th className="w-8 border-b border-line p-2" />
                <th className="border-b border-line p-2">Type</th>
                <th className="border-b border-line p-2">Word</th>
                <th className="border-b border-line p-2">Shared update</th>
                <th className="border-b border-line p-2">Current local</th>
                <th className="border-b border-line p-2">Safety</th>
              </tr>
            </thead>
            <tbody>
              {data.updates.map((update) => {
                const id = updateId(update);
                const selected = selectedUpdates.has(id);
                const isRemoval = update.type.endsWith('-removal');
                const alternativeCount = Math.max(0, (update.gitChoices?.length || 0) - 1);
                return (
                  <tr key={id} className="border-b border-line last:border-0 hover:bg-accent-wash">
                    <td className="p-2 text-center">
                      <input
                        type="checkbox"
                        checked={selected}
                        aria-label={`Select ${updateLabel(update)} for ${update.word}`}
                        onChange={(event) => {
                          setSelectedUpdates((current) => {
                            const next = new Set(current);
                            if (event.target.checked) next.add(id);
                            else next.delete(id);
                            return next;
                          });
                        }}
                      />
                    </td>
                    <td className="p-2">
                      <span className={`rounded px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                        isRemoval
                          ? 'bg-danger-wash text-danger'
                          : 'bg-accent-wash text-accent'
                      }`}>
                        {updateLabel(update)}
                      </span>
                    </td>
                    <td className="p-2 font-medium">{update.word}</td>
                    <td className="max-w-[240px] p-2 text-accent">
                      {isRemoval ? (
                        <span className="text-danger">Remove retired entry</span>
                      ) : (
                        <span title={update.git || undefined}>
                          {update.git}
                          {alternativeCount > 0 ? ` (+${alternativeCount} choices)` : ''}
                        </span>
                      )}
                    </td>
                    <td className="max-w-[240px] truncate p-2 text-soft" title={update.local || undefined}>
                      {update.local || <span className="text-xs italic">Not present</span>}
                    </td>
                    <td className="p-2 text-xs">
                      <span className={update.safeToApply ? 'text-success' : 'text-warning'}>
                        {statusLabel(update)}
                      </span>
                      {update.reasons?.length ? (
                        <div className="mt-1 max-w-[220px] text-[10px] text-soft">
                          {update.reasons.join(', ')}
                        </div>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between pt-4">
          <button
            type="button"
            onClick={() => setData(null)}
            disabled={isSaving}
            className="text-sm text-soft hover:text-foreground disabled:opacity-50"
          >
            Remind Me Later
          </button>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => handleApply(true)}
              disabled={isSaving}
              className="rounded border border-line bg-surface px-4 py-2 text-sm text-foreground hover:bg-accent-wash disabled:opacity-50"
            >
              Keep Current and Dismiss
            </button>
            <button
              type="button"
              onClick={() => handleApply(false)}
              disabled={isSaving || selectedUpdates.size === 0}
              className="rounded bg-accent px-4 py-2 text-sm font-medium text-background hover:opacity-90 disabled:opacity-50"
            >
              {isSaving ? 'Saving…' : `Apply Selected (${selectedUpdates.size})`}
            </button>
          </div>
        </div>
      </div>
    </ModalFrame>
  );
}
