'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  KOKORO_CHARACTER_VOICES,
  normalizeSmartAudioCharacterMap,
} from '@/lib/shared/multi-voice';
import type { SmartAudioCharacterMap } from '@/types/document-settings';

interface MultiVoiceCharacterModalProps {
  documentId: string;
  profileId: string;
  isOpen: boolean;
  jobId?: string;
  standalone?: boolean;
  onClose: () => void;
  onComplete: () => void | Promise<void>;
}

type CastResponse = {
  characterMap?: SmartAudioCharacterMap | null;
  code?: string;
  error?: string;
  message?: string;
  retryAfterMs?: number;
};

export function MultiVoiceCharacterModal({
  documentId,
  profileId,
  isOpen,
  jobId,
  standalone = false,
  onClose,
  onComplete,
}: MultiVoiceCharacterModalProps) {
  const [characterMap, setCharacterMap] = useState<SmartAudioCharacterMap | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isPlaying, setIsPlaying] = useState<string | null>(null);
  const [renamingName, setRenamingName] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const audioUrl = useRef<string | null>(null);
  const scanInFlight = useRef(false);

  const clearTransientResources = useCallback(() => {
    if (retryTimer.current) clearTimeout(retryTimer.current);
    retryTimer.current = null;
    if (audioUrl.current) URL.revokeObjectURL(audioUrl.current);
    audioUrl.current = null;
  }, []);

  const scanCharacters = useCallback(async () => {
    if (!isOpen || scanInFlight.current) return;
    scanInFlight.current = true;
    setIsScanning(true);
    setError(null);
    setStatusMessage('Scanning filtered audiobook text for speaking characters…');
    try {
      const response = await fetch('/api/audiobook/characters/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ documentId, profileId }),
      });
      const body = await response.json().catch(() => ({})) as CastResponse;
      if (response.status === 202 && body.code === 'PDF_PARSE_PENDING') {
        setStatusMessage(body.message || 'Waiting for PDF layout analysis…');
        retryTimer.current = setTimeout(() => {
          scanInFlight.current = false;
          void scanCharacters();
        }, Math.max(1_000, Math.min(10_000, body.retryAfterMs || 2_000)));
        return;
      }
      if (!response.ok) throw new Error(body.error || body.message || 'Character scan failed.');
      const normalized = normalizeSmartAudioCharacterMap(body.characterMap);
      if (!normalized) throw new Error('Character scan returned an invalid cast.');
      setCharacterMap(normalized);
      setStatusMessage(null);
    } catch (scanError) {
      setError(scanError instanceof Error ? scanError.message : 'Character scan failed.');
      setStatusMessage(null);
    } finally {
      scanInFlight.current = false;
      setIsScanning(false);
    }
  }, [documentId, isOpen, profileId]);

  useEffect(() => {
    if (!isOpen) {
      clearTransientResources();
      return;
    }
    let cancelled = false;
    setIsLoading(true);
    setError(null);
    setStatusMessage('Loading the saved Audio Drama cast…');
    void fetch(`/api/audiobook/characters/scan?documentId=${encodeURIComponent(documentId)}&profileId=${encodeURIComponent(profileId)}`, {
      cache: 'no-store',
    }).then(async (response) => {
      const body = await response.json().catch(() => ({})) as CastResponse;
      if (!response.ok) throw new Error(body.error || 'Failed to load the character cast.');
      if (cancelled) return;
      const normalized = normalizeSmartAudioCharacterMap(body.characterMap);
      if (normalized?.profileId === profileId && !normalized.needsRescan) {
        setCharacterMap(normalized);
        setStatusMessage(null);
      } else {
        setCharacterMap(null);
        setStatusMessage(normalized?.needsRescan
          ? 'The document narration filters changed. Start a new character scan to refresh the drama cast.'
          : 'No Audio Drama character scan is saved yet. Start the scanner when you are ready to use Gemini credits.');
      }
    }).catch((loadError) => {
      if (!cancelled) {
        setStatusMessage(null);
        setError(loadError instanceof Error ? loadError.message : 'Failed to load the cast.');
      }
    }).finally(() => {
      if (!cancelled) setIsLoading(false);
    });
    return () => {
      cancelled = true;
      clearTransientResources();
    };
  }, [clearTransientResources, documentId, isOpen, profileId, scanCharacters]);

  const entries = useMemo(() => Object.values(characterMap?.entries || {}), [characterMap]);
  const primaryCharacters = entries.filter((entry) => !entry.aliasFor);
  const unassigned = primaryCharacters.filter((entry) => !entry.voiceId);
  const hasNarrator = primaryCharacters.some((entry) => entry.name.toLocaleLowerCase() === 'narrator');

  const updateEntry = (name: string, update: (entry: SmartAudioCharacterMap['entries'][string]) => void) => {
    setCharacterMap((current) => {
      if (!current?.entries[name]) return current;
      const entriesCopy = Object.fromEntries(
        Object.entries(current.entries).map(([key, value]) => [key, { ...value }]),
      );
      update(entriesCopy[name]);
      return { ...current, status: 'partial', entries: entriesCopy };
    });
  };

  const handleAliasChange = (name: string, aliasFor: string) => {
    updateEntry(name, (entry) => {
      entry.aliasFor = aliasFor === 'none' ? null : aliasFor;
      if (entry.aliasFor) entry.voiceId = null;
    });
  };

  const handlePreview = async (name: string) => {
    const entry = characterMap?.entries[name];
    if (!entry?.voiceId) return;
    setIsPlaying(name);
    setError(null);
    try {
      const previewText = entry.sampleText || `${entry.name} is ready for the adventure.`;
      const response = await fetch('/api/tts/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: previewText, voice: entry.voiceId }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error || 'Voice preview failed.');
      }
      if (audioUrl.current) URL.revokeObjectURL(audioUrl.current);
      audioUrl.current = URL.createObjectURL(await response.blob());
      const audio = new Audio(audioUrl.current);
      audio.onended = () => setIsPlaying(null);
      audio.onerror = () => setIsPlaying(null);
      await audio.play();
    } catch (previewError) {
      setError(previewError instanceof Error ? previewError.message : 'Voice preview failed.');
      setIsPlaying(null);
    }
  };

  const addCharacter = () => {
    if (!characterMap) return;
    let index = 1;
    let name = 'New Character';
    while (characterMap.entries[name]) name = `New Character ${++index}`;
    setCharacterMap({
      ...characterMap,
      status: 'partial',
      entries: {
        ...characterMap.entries,
        [name]: {
          name,
          description: 'Manually added cast member.',
          sampleText: '',
          voiceId: null,
          aliasFor: null,
        },
      },
    });
    setRenamingName(name);
    setRenameDraft(name);
  };

  const commitRename = () => {
    if (!renamingName || !characterMap) return;
    const nextName = renameDraft.trim();
    if (!nextName) {
      setError('Character names cannot be empty.');
      return;
    }
    const duplicate = Object.keys(characterMap.entries).some(
      (name) => name !== renamingName && name.toLocaleLowerCase() === nextName.toLocaleLowerCase(),
    );
    if (duplicate) {
      setError(`A cast member named “${nextName}” already exists.`);
      return;
    }
    const renamed = characterMap.entries[renamingName];
    if (!renamed) return;
    const nextEntries = Object.fromEntries(
      Object.entries(characterMap.entries).map(([name, entry]) => {
        if (name === renamingName) return [nextName, { ...entry, name: nextName }];
        return [name, entry.aliasFor === renamingName ? { ...entry, aliasFor: nextName } : entry];
      }),
    );
    setCharacterMap({ ...characterMap, status: 'partial', entries: nextEntries });
    setRenamingName(null);
    setRenameDraft('');
    setError(null);
  };

  const removeCharacter = (name: string) => {
    if (name.toLocaleLowerCase() === 'narrator') return;
    setCharacterMap((current) => {
      if (!current) return current;
      const nextEntries = Object.fromEntries(
        Object.entries(current.entries)
          .filter(([key]) => key !== name)
          .map(([key, entry]) => [key, entry.aliasFor === name ? { ...entry, aliasFor: null } : entry]),
      );
      return { ...current, status: 'partial', entries: nextEntries };
    });
  };

  const handleSave = async () => {
    if (!characterMap || unassigned.length > 0 || !hasNarrator) return;
    setIsSaving(true);
    setError(null);
    try {
      const response = await fetch('/api/audiobook/characters/scan', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ documentId, profileId, jobId, characterMap }),
      });
      const body = await response.json().catch(() => ({})) as CastResponse;
      if (!response.ok) throw new Error(body.error || 'Failed to save the reviewed cast.');
      await onComplete();
      onClose();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Failed to save the reviewed cast.');
    } finally {
      setIsSaving(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl">
        <div className="flex items-center justify-between border-b border-line p-5">
          <div>
            <h2 className="text-xl font-bold text-text-strong">Audio Drama Character Pre-Scan</h2>
            <p className="mt-1 text-sm text-text-soft">Find and review the speaking cast before Audio Drama generation.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-full p-2 text-text-soft hover:bg-surface-raised hover:text-text-strong" aria-label="Close casting dialog">✕</button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto bg-surface-sunken p-5">
          {statusMessage && (
            <div className="rounded-xl border border-accent-line bg-accent-wash p-4 text-sm text-text-strong">
              {statusMessage}
            </div>
          )}
          <div className="rounded-xl border border-line bg-surface p-4 text-sm text-text-soft">
            This separate scan is used only for Audio Drama casting. Regular LitRPG audiobooks do not scan characters or spend Gemini credits on cast detection.
            {standalone && ' Saving this cast will not start audiobook generation.'}
          </div>
          {error && <div className="rounded-xl border border-danger bg-danger-wash p-4 text-sm text-danger">{error}</div>}

          {entries.map((character) => (
            <div key={character.name} className="rounded-xl border border-line bg-surface p-4 shadow-sm">
              <div className="flex flex-col gap-4 md:flex-row md:items-start">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    {renamingName === character.name ? (
                      <div className="flex min-w-0 flex-1 items-center gap-2">
                        <input
                          autoFocus
                          value={renameDraft}
                          onChange={(event) => setRenameDraft(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') commitRename();
                            if (event.key === 'Escape') setRenamingName(null);
                          }}
                          className="min-w-0 flex-1 rounded-lg border border-line bg-background px-2 py-1 font-semibold text-foreground"
                          aria-label="Character name"
                        />
                        <button type="button" onClick={commitRename} className="text-xs font-semibold text-accent hover:underline">Save name</button>
                        <button type="button" onClick={() => setRenamingName(null)} className="text-xs text-text-soft hover:underline">Cancel</button>
                      </div>
                    ) : (
                      <>
                        <h3 className="font-semibold text-text-strong">{character.name}</h3>
                        {character.name.toLocaleLowerCase() !== 'narrator' && (
                          <button
                            type="button"
                            onClick={() => { setRenamingName(character.name); setRenameDraft(character.name); }}
                            className="text-xs text-accent hover:underline"
                          >
                            Rename
                          </button>
                        )}
                      </>
                    )}
                    {character.aliasFor && <span className="rounded-full bg-surface-raised px-2 py-0.5 text-xs text-text-soft">Alias for {character.aliasFor}</span>}
                  </div>
                  <p className="mt-1 text-sm text-text-soft">{character.description || 'No description supplied.'}</p>
                  <p className="mt-2 rounded-lg bg-surface-sunken p-3 text-sm italic text-text-soft">“{character.sampleText || 'No sample quote was found.'}”</p>
                </div>
                <div className="w-full space-y-2 md:w-72">
                  <select
                    value={character.aliasFor || 'none'}
                    onChange={(event) => handleAliasChange(character.name, event.target.value)}
                    className="w-full rounded-lg border border-line bg-background p-2 text-sm text-foreground"
                  >
                    <option value="none">Primary character</option>
                    {primaryCharacters.filter((candidate) => candidate.name !== character.name).map((candidate) => (
                      <option key={candidate.name} value={candidate.name}>Alias for {candidate.name}</option>
                    ))}
                  </select>
                  {!character.aliasFor && (
                    <div className="flex gap-2">
                      <select
                        value={character.voiceId || ''}
                        onChange={(event) => updateEntry(character.name, (entry) => { entry.voiceId = event.target.value; })}
                        className="min-w-0 flex-1 rounded-lg border border-line bg-background p-2 text-sm text-foreground"
                      >
                        <option value="">Select a Kokoro voice</option>
                        {KOKORO_CHARACTER_VOICES.map((voice) => <option key={voice} value={voice}>{voice}</option>)}
                      </select>
                      <button type="button" onClick={() => void handlePreview(character.name)} disabled={!character.voiceId || isPlaying === character.name} className="rounded-lg border border-accent px-3 text-accent disabled:opacity-50" title="Preview this character voice">
                        {isPlaying === character.name ? '…' : '▶'}
                      </button>
                    </div>
                  )}
                  {character.name.toLocaleLowerCase() !== 'narrator' && (
                    <button type="button" onClick={() => removeCharacter(character.name)} className="text-xs text-danger hover:underline">Remove false detection</button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="flex flex-col gap-3 border-t border-line p-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-sm text-text-soft">
            {!hasNarrator ? (characterMap ? 'A Narrator entry is required.' : 'Start the character scanner to create a drama cast.') : unassigned.length > 0 ? `${unassigned.length} primary character${unassigned.length === 1 ? '' : 's'} still need a voice.` : entries.length > 0 ? 'Cast is ready to save.' : 'Start the character scanner to create a drama cast.'}
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" onClick={addCharacter} disabled={!characterMap || isScanning} className="rounded-lg border border-line px-4 py-2 text-sm text-foreground disabled:opacity-50">Add Character</button>
            <button type="button" onClick={() => void scanCharacters()} disabled={isScanning || isSaving || isLoading} className="rounded-lg border border-line px-4 py-2 text-sm text-foreground disabled:opacity-50">{characterMap ? 'Rescan Drama Cast' : 'Start Character Scan'}</button>
            <button type="button" onClick={onClose} className="rounded-lg border border-line px-4 py-2 text-sm text-text-soft">Cancel</button>
            <button type="button" onClick={() => void handleSave()} disabled={!characterMap || !hasNarrator || unassigned.length > 0 || isSaving || isScanning} className="rounded-lg bg-accent px-5 py-2 text-sm font-semibold text-background disabled:opacity-50">
              {isSaving ? 'Saving…' : jobId ? 'Save Cast & Resume' : standalone ? 'Save Cast' : 'Save Cast & Continue'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
