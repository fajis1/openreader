'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { ReaderSidebarShell } from '@/components/reader/ReaderSidebarShell';
import { useConfig } from '@/contexts/ConfigContext';
import { VoicesControlBase } from '@/components/player/VoicesControlBase';
import { Button, Select, Card } from '@/components/ui';
import { getVoices } from '@/lib/client/api/audiobooks';
import { resolveTtsProviderModelPolicy } from '@/lib/shared/tts-provider-policy';
import type { TTSAudiobookFormat } from '@/types/tts';
import type { DocumentListDocument } from '@/types/documents';
import type { SmartAudioProfile } from '@/types/client';

interface BatchAudiobookSidebarProps {
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
  selectedDocs: DocumentListDocument[];
}

export function BatchAudiobookSidebar({ isOpen, setIsOpen, selectedDocs }: BatchAudiobookSidebarProps) {
  const router = useRouter();
  const {
    providerType,
    ttsModel,
    apiKey,
    baseUrl,
    providerRef,
    voiceSpeed,
    audioPlayerSpeed,
    smartAudioProfileId,
    voice: configVoice,
  } = useConfig();

  // ── Voice state ──────────────────────────────────────────────────────────
  const [availableVoices, setAvailableVoices] = useState<string[]>([]);
  const [audiobookVoice, setAudiobookVoice] = useState<string>(configVoice || '');
  const [isFetchingVoices, setIsFetchingVoices] = useState(false);

  const providerModelPolicy = resolveTtsProviderModelPolicy({ providerRef, providerType, model: ttsModel });

  const fetchVoices = useCallback(async () => {
    setIsFetchingVoices(true);
    try {
      const data = await getVoices({
        'x-openai-key': apiKey || '',
        'x-openai-base-url': baseUrl || '',
        'x-tts-provider': providerRef || 'openai',
        'x-tts-model': ttsModel || 'tts-1',
        'Content-Type': 'application/json',
      });
      const voices =
        data.voices && data.voices.length > 0
          ? data.voices
          : providerModelPolicy.defaultVoices;
      setAvailableVoices(voices);
      // Only set default voice if we don't have one yet
      setAudiobookVoice((prev) => (prev && voices.includes(prev) ? prev : voices[0] || ''));
    } catch {
      const fallback = providerModelPolicy.defaultVoices;
      setAvailableVoices(fallback);
      setAudiobookVoice((prev) => (prev && fallback.includes(prev) ? prev : fallback[0] || ''));
    } finally {
      setIsFetchingVoices(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiKey, baseUrl, providerRef, ttsModel]);

  // Fetch voices whenever the sidebar opens
  useEffect(() => {
    if (isOpen) {
      void fetchVoices();
    }
  }, [isOpen, fetchVoices]);

  // ── Format ───────────────────────────────────────────────────────────────
  const [audiobookFormat, setAudiobookFormat] = useState<TTSAudiobookFormat>('m4b');

  // ── Smart AI ─────────────────────────────────────────────────────────────
  const [useSmartAudio, setUseSmartAudio] = useState(false);
  const [smartAudioProfiles, setSmartAudioProfiles] = useState<SmartAudioProfile[]>([]);
  const [selectedSmartAudioProfileId, setSelectedSmartAudioProfileId] = useState(smartAudioProfileId || '');
  const [isLoadingProfiles, setIsLoadingProfiles] = useState(false);

  // Load profiles as soon as the sidebar mounts (not just when it opens),
  // so they are ready when the user clicks the Smart AI toggle.
  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      setIsLoadingProfiles(true);
      try {
        const res = await fetch('/api/tts-settings', { signal: controller.signal });
        if (!res.ok) {
          console.warn('tts-settings returned', res.status, res.statusText);
          return;
        }
        const data = await res.json();
        console.log('[BatchAudiobookSidebar] tts-settings response:', data);
        const profiles: SmartAudioProfile[] = Array.isArray(data.smartAudioProfiles) ? data.smartAudioProfiles : [];
        setSmartAudioProfiles(profiles);
        const preferred = typeof data.selectedSmartAudioProfileId === 'string' && data.selectedSmartAudioProfileId
          ? data.selectedSmartAudioProfileId
          : smartAudioProfileId;
        const next = profiles.some((p) => p.id === preferred) ? preferred : profiles[0]?.id || '';
        setSelectedSmartAudioProfileId(next || '');
      } catch (err) {
        if ((err as Error)?.name === 'AbortError') return;
        console.warn('[BatchAudiobookSidebar] Failed to load smart audio profiles:', err);
      } finally {
        setIsLoadingProfiles(false);
      }
    };

    void load();

    const handleUpdate = () => {
      void load();
    };
    window.addEventListener('smart-audio-profiles-updated', handleUpdate);

    return () => {
      controller.abort();
      window.removeEventListener('smart-audio-profiles-updated', handleUpdate);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectedSmartAudioProfile = smartAudioProfiles.find((p) => p.id === selectedSmartAudioProfileId) || smartAudioProfiles[0] || null;

  // ── Queueing ─────────────────────────────────────────────────────────────
  const [isQueueing, setIsQueueing] = useState(false);
  const [queueError, setQueueError] = useState<string | null>(null);
  const [queuedCount, setQueuedCount] = useState(0);

  const handleStartBatch = async () => {
    if (selectedDocs.length === 0) return;
    setIsQueueing(true);
    setQueueError(null);
    setQueuedCount(0);
    try {
      const settings = {
        voice: audiobookVoice,
        format: audiobookFormat,
        providerRef: providerRef || '',
        providerType,
        ttsModel,
        nativeSpeed: voiceSpeed || 1,
        postSpeed: audioPlayerSpeed || 1,
        useSmartAudio,
        smartAudioProfileId: useSmartAudio ? selectedSmartAudioProfileId : undefined,
      };

      let count = 0;
      for (const doc of selectedDocs) {
        const res = await fetch('/api/audiobooks/queue', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ documentId: doc.id, settings }),
        });
        if (res.ok) count++;
      }
      setQueuedCount(count);
      setIsOpen(false);
      router.refresh();
    } catch (e) {
      console.error(e);
      setQueueError('Failed to enqueue some audiobooks. Please try again.');
    } finally {
      setIsQueueing(false);
    }
  };

  const providerLabel = providerRef || 'Default (from Admin Settings)';

  return (
    <ReaderSidebarShell
      isOpen={isOpen}
      onClose={() => setIsOpen(false)}
      ariaLabel="Batch Export Audiobooks"
      title="Batch Export"
      subtitle={`Generate audiobooks for ${selectedDocs.length} document${selectedDocs.length !== 1 ? 's' : ''}.`}
    >
      <div className="p-4 space-y-4 overflow-y-auto">

        {/* Provider info card */}
        <div className="rounded-lg bg-surface-raised border border-line px-3 py-2.5 space-y-0.5">
          <p className="text-[11px] uppercase tracking-wider font-medium text-soft">TTS Provider</p>
          <p className="text-sm text-primary truncate">{providerLabel}</p>
          {ttsModel && <p className="text-xs text-soft">Model: {ttsModel}</p>}
          <p className="text-[11px] text-soft mt-1">Change provider in Settings to switch.</p>
        </div>

        {/* Voice picker */}
        <div className="space-y-1.5">
          <label className="text-[11px] uppercase tracking-wider font-medium text-soft">
            Voice {isFetchingVoices && <span className="text-soft normal-case">(loading…)</span>}
          </label>
          <VoicesControlBase
            availableVoices={availableVoices}
            voice={audiobookVoice}
            onChangeVoice={setAudiobookVoice}
            providerType={providerType}
            ttsModel={ttsModel}
            dropdownDirection="down"
            variant="field"
          />
          {!isFetchingVoices && availableVoices.length === 0 && (
            <p className="text-xs text-soft italic">
              No voices found. Make sure a TTS provider is configured in Settings.
            </p>
          )}
        </div>

        {/* Format picker */}
        <div className="space-y-1.5">
          <label className="text-[11px] uppercase tracking-wider font-medium text-soft">Format</label>
          <Select
            value={audiobookFormat}
            options={['m4b', 'mp3'] as TTSAudiobookFormat[]}
            renderValue={(v) => (v === 'm4b' ? 'M4B (Apple Books)' : 'MP3 (Universal)')}
            renderOption={(v) => (v === 'm4b' ? 'M4B (Apple Books)' : 'MP3 (Universal)')}
            onChange={(v) => setAudiobookFormat(v)}
          />
        </div>

        {/* Smart AI Toggle */}
        <Card className="p-3">
          <label className="flex items-center justify-between cursor-pointer">
            <div className="space-y-0.5 pr-4">
              <span className="text-sm font-medium text-foreground">Smart AI Formatting</span>
              <p className="text-xs text-soft">
                Use AI to process footnotes, apply phonetics, and fix layout artifacts before TTS generation.
              </p>
            </div>
            <div className="relative inline-flex items-center shrink-0">
              <input
                type="checkbox"
                className="peer sr-only"
                checked={useSmartAudio}
                onChange={(e) => {
                  if (e.target.checked && smartAudioProfiles.length === 0) {
                    window.alert('No Smart AI profile exists. Please create one to use this feature.');
                    window.dispatchEvent(new CustomEvent('open-smart-ai-profiles'));
                    setUseSmartAudio(false);
                  } else if (e.target.checked) {
                    const currentProfile = smartAudioProfiles.find(p => p.id === selectedSmartAudioProfileId) || smartAudioProfiles[0];
                    if (!currentProfile?.geminiApiKey) {
                      window.alert('The selected Smart AI profile does not have a Gemini API key configured. Please add one in the Smart AI profile settings.');
                      window.dispatchEvent(new CustomEvent('open-smart-ai-profiles'));
                      setUseSmartAudio(false);
                    } else {
                      setUseSmartAudio(true);
                    }
                  } else {
                    setUseSmartAudio(false);
                  }
                }}
              />
              <div className="h-6 w-11 rounded-full bg-surface-sunken border border-line peer-checked:bg-accent peer-checked:border-accent after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:bg-white after:transition-transform peer-checked:after:translate-x-full" />
            </div>
          </label>
        </Card>

        {/* Smart AI Profile picker (shown only when enabled) */}
        {useSmartAudio && (
          <Card className="p-3">
            <div className="space-y-2">
              <label className="block text-sm font-medium text-foreground">Smart AI Profile</label>
              {isLoadingProfiles ? (
                <p className="text-xs text-soft italic">Loading profiles…</p>
              ) : smartAudioProfiles.length === 0 ? (
                <p className="text-xs text-soft italic">
                  No smart AI profiles found. Create one in{' '}
                  <span className="underline">Settings → Smart AI</span>.
                </p>
              ) : (
                <>
                  <select
                    className="w-full rounded-md border border-line bg-background px-3 py-2 text-sm text-foreground"
                    value={selectedSmartAudioProfileId}
                    onChange={(e) => {
                      const newProfileId = e.target.value;
                      const newProfile = smartAudioProfiles.find(p => p.id === newProfileId);
                      if (!newProfile?.geminiApiKey) {
                        window.alert('This Smart AI profile does not have a Gemini API key configured. Please add one in the Smart AI profile settings.');
                        window.dispatchEvent(new CustomEvent('open-smart-ai-profiles'));
                        setUseSmartAudio(false);
                      }
                      setSelectedSmartAudioProfileId(newProfileId);
                    }}
                  >
                    {smartAudioProfiles.map((profile) => (
                      <option key={profile.id} value={profile.id}>
                        {profile.name}
                      </option>
                    ))}
                  </select>
                  {selectedSmartAudioProfile && (
                    <p className="text-xs text-soft">
                      {selectedSmartAudioProfile.aiModel} ·{' '}
                      {Object.keys(selectedSmartAudioProfile.abbreviations || {}).length} abbreviations ·{' '}
                      {Object.keys(selectedSmartAudioProfile.pronunciations || {}).length} pronunciations
                    </p>
                  )}
                </>
              )}
            </div>
          </Card>
        )}

        {/* Selected documents preview */}
        {selectedDocs.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-[11px] uppercase tracking-wider font-medium text-soft">
              Queued Documents ({selectedDocs.length})
            </p>
            <div className="rounded-lg border border-line bg-surface-sunken max-h-40 overflow-y-auto divide-y divide-line">
              {selectedDocs.map((doc) => (
                <div key={doc.id} className="px-3 py-2 text-sm text-primary truncate">
                  {doc.name}
                </div>
              ))}
            </div>
          </div>
        )}

        {queueError && (
          <p className="text-xs text-destructive">{queueError}</p>
        )}

        {/* Action */}
        <div className="space-y-2 pt-1">
          <Button
            className="w-full"
            variant="primary"
            onClick={handleStartBatch}
            disabled={isQueueing || selectedDocs.length === 0 || availableVoices.length === 0}
          >
            {isQueueing
              ? `Queueing ${selectedDocs.length} book${selectedDocs.length !== 1 ? 's' : ''}…`
              : `Queue ${selectedDocs.length} Audiobook${selectedDocs.length !== 1 ? 's' : ''}`}
          </Button>
          <p className="text-[11px] text-soft text-center">
            Generation runs on the server — safe to close your browser.
          </p>
        </div>

        {queuedCount > 0 && (
          <p className="text-xs text-success text-center">
            ✓ {queuedCount} job{queuedCount !== 1 ? 's' : ''} added to the queue.
          </p>
        )}
      </div>
    </ReaderSidebarShell>
  );
}
