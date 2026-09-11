'use client';

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import {
  Badge,
  Section,
  ToggleRow,
  Select,
  Button,
  Input,
} from '@/components/ui';
import { type TtsProviderId } from '@/lib/shared/tts-provider-catalog';
import { useSharedProviders, type SharedProviderEntry } from '@/hooks/useSharedProviders';

type RuntimeConfigSource = 'json-seed' | 'env-seed' | 'admin' | 'default';

interface SettingsResponse {
  values: Record<string, unknown>;
  sources: Record<string, RuntimeConfigSource>;
}

interface ProviderOption {
  id: string;
  name: string;
  providerType: TtsProviderId;
}

const ADMIN_SETTINGS_QUERY_KEY = ['admin-settings'] as const;

async function fetchAdminSettings(): Promise<SettingsResponse> {
  const res = await fetch('/api/admin/settings');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as SettingsResponse;
}

async function patchAdminSettings(payload: { updates?: Record<string, unknown>; reset?: string[] }): Promise<void> {
  const res = await fetch('/api/admin/settings', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok && res.status !== 207) throw new Error(`HTTP ${res.status}`);
}

export function AdminFeaturesPanel() {
  const queryClient = useQueryClient();
  const { data, error } = useQuery({
    queryKey: ADMIN_SETTINGS_QUERY_KEY,
    queryFn: fetchAdminSettings,
  });
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const { providers: sharedProviders } = useSharedProviders();
  const [showAbsToken, setShowAbsToken] = useState(false);
  const [showGeminiKey, setShowGeminiKey] = useState(false);
  const [isTestingAbs, setIsTestingAbs] = useState(false);
  const [absTestStatus, setAbsTestStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [absTestError, setAbsTestError] = useState<string>('');
  const [absLibraries, setAbsLibraries] = useState<Array<{ id: string; name: string; mediaType: string; folders: Array<{ id: string; fullPath: string }> }>>([]);

  useEffect(() => {
    if (!data) return;
    setDraft({ ...data.values });
    setDirty(new Set());
    if (data.values?.audiobookshelfToken) {
      fetch('/api/admin/audiobookshelf/test')
        .then((res) => (res.ok ? res.json() : null))
        .then((json) => {
          if (json?.ok && Array.isArray(json.libraries)) {
            setAbsLibraries(json.libraries);
          }
        })
        .catch(() => {});
    }
  }, [data]);

  useEffect(() => {
    if (!error) return;
    console.error('[AdminFeaturesPanel] load failed:', error);
    toast.error('Failed to load site settings');
  }, [error]);

  const resetMutation = useMutation({
    mutationFn: async (key: string) => {
      await patchAdminSettings({ reset: [key] });
    },
    onSuccess: async () => {
      toast.success('Reset to env default');
      await queryClient.invalidateQueries({ queryKey: ADMIN_SETTINGS_QUERY_KEY });
    },
    onError: (mutationError) => {
      console.error(mutationError);
      toast.error('Reset failed');
    },
  });

  const saveMutation = useMutation({
    mutationFn: async (updates: Record<string, unknown>) => {
      await patchAdminSettings({ updates });
    },
    onSuccess: async () => {
      toast.success('Settings saved');
      await queryClient.invalidateQueries({ queryKey: ADMIN_SETTINGS_QUERY_KEY });
    },
    onError: (mutationError) => {
      console.error(mutationError);
      toast.error('Save failed');
    },
  });

  const saving = resetMutation.isPending || saveMutation.isPending;

  const updateDraft = (key: string, value: unknown) => {
    setDraft((d) => ({ ...d, [key]: value }));
    setDirty((s) => {
      const next = new Set(s);
      const baselineValue = data?.values?.[key];
      if (Object.is(value, baselineValue)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const updatePositiveIntDraft = (key: string, raw: string) => {
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return;
    updateDraft(key, Math.max(1, Math.floor(parsed)));
  };

  const resetField = (key: string) => {
    if (saving) return;
    resetMutation.mutate(key);
  };

  const saveAll = () => {
    if (saving || dirty.size === 0) return;
    const updates: Record<string, unknown> = {};
    for (const key of dirty) updates[key] = draft[key];
    saveMutation.mutate(updates);
  };

  const discardAll = () => {
    if (!data) return;
    setDraft({ ...data.values });
    setDirty(new Set());
  };

  const providerOptions = useMemo<ProviderOption[]>(() => {
    return sharedProviders.map((entry) => ({
      id: entry.slug,
      name: `${entry.displayName} (shared)`,
      providerType: entry.providerType,
    }));
  }, [sharedProviders]);

  const currentProviderId =
    typeof draft.defaultTtsProvider === 'string'
      ? draft.defaultTtsProvider
      : '';
  const currentSharedEntry: SharedProviderEntry | undefined = sharedProviders.find(
    (p) => p.slug === currentProviderId,
  );
  const fallbackShared = providerOptions[0];
  const effectiveSelectedProvider = currentSharedEntry
    ? {
      id: currentSharedEntry.slug,
      name: `${currentSharedEntry.displayName} (shared)`,
      providerType: currentSharedEntry.providerType,
    } as ProviderOption
    : fallbackShared;
  const selectedProviderOption = effectiveSelectedProvider;
  const shouldRenderRateLimitInputs = draft.disableTtsRateLimit === false;
  const shouldRenderComputeRateLimitInputs = draft.disableComputeRateLimit === false;

  const handleProviderChange = (opt: ProviderOption) => {
    updateDraft('defaultTtsProvider', opt.id);
  };

  const currentLibraryFolders = useMemo(() => {
    const selectedLibId = String(draft.audiobookshelfLibraryId ?? '');
    const lib = absLibraries.find((l) => l.id === selectedLibId);
    return lib ? lib.folders : [];
  }, [absLibraries, draft.audiobookshelfLibraryId]);

  const handleTestAbsConnection = async () => {
    setIsTestingAbs(true);
    setAbsTestStatus('idle');
    setAbsTestError('');
    try {
      const res = await fetch('/api/admin/audiobookshelf/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: draft.audiobookshelfUrl,
          token: draft.audiobookshelfToken,
        }),
      });
      const json = await res.json();
      if (res.ok && json.ok) {
        setAbsTestStatus('success');
        const libs = Array.isArray(json.libraries) ? json.libraries : [];
        setAbsLibraries(libs);
        toast.success(`Connected to Audiobookshelf! Found ${libs.length} libraries.`);
        if (libs.length > 0 && !draft.audiobookshelfLibraryId) {
          updateDraft('audiobookshelfLibraryId', libs[0].id);
          if (libs[0].folders?.length > 0 && !draft.audiobookshelfFolderId) {
            updateDraft('audiobookshelfFolderId', libs[0].folders[0].id);
          }
        }
      } else {
        setAbsTestStatus('error');
        setAbsTestError(json.error || 'Connection test failed');
        toast.error(json.error || 'Failed to connect to Audiobookshelf');
      }
    } catch (err) {
      setAbsTestStatus('error');
      setAbsTestError((err as Error).message || 'Connection test failed');
      toast.error('Failed to connect to Audiobookshelf');
    } finally {
      setIsTestingAbs(false);
    }
  };

  const renderSource = (key: string) => {
    const source = data?.sources?.[key] ?? 'default';
    const isDirty = dirty.has(key);
    return (
      <SourceBadge
        source={source}
        dirty={isDirty}
        canReset={source !== 'default'}
        onReset={() => resetField(key)}
        saving={saving}
      />
    );
  };

  if (!data) {
    return (
      <AdminFeaturesSkeleton />
    );
  }

  return (
    <div className="space-y-4">
      <Section
        title="TTS defaults"
        subtitle="Defaults for new users."
        action={<Badge tone="foreground">Defaults</Badge>}
      >
        <div className="space-y-1.5 pb-2 border-b border-offbase">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">Default TTS provider</p>
              <p className="text-xs text-muted mt-0.5">
                Starting provider for new users.
              </p>
            </div>
            <div className="shrink-0">{renderSource('defaultTtsProvider')}</div>
          </div>
          {providerOptions.length > 0 ? (
            <Select
              value={selectedProviderOption}
              onChange={handleProviderChange}
              options={providerOptions}
              getOptionKey={(option) => option.id}
              renderValue={(option) => option.name}
              renderOption={(option, { selected }) => (
                <span className={`block truncate ${selected ? 'font-medium' : 'font-normal'}`}>
                  {option.name}
                </span>
              )}
              chevronClassName="h-4 w-4 text-muted"
            />
          ) : (
            <div className="px-0.5 py-2 text-sm text-muted">
              No shared providers yet. Add one first.
            </div>
          )}
        </div>

        <ToggleRow
          label="Restrict user API keys (recommended)"
          description="Only allow admin shared providers."
          checked={Boolean(draft.restrictUserApiKeys)}
          onChange={(checked) => {
            if (!checked) {
              const ok = confirm(
                'Turning this off allows user-supplied API keys to flow through this server. Continue?',
              );
              if (!ok) return;
            }
            updateDraft('restrictUserApiKeys', checked);
          }}
          right={renderSource('restrictUserApiKeys')}
          variant="flat"
        />
        <ToggleRow
          label="Show TTS provider settings tab"
          description="Allow per-user provider overrides."
          checked={Boolean(draft.enableTtsProvidersTab)}
          onChange={(checked) => updateDraft('enableTtsProvidersTab', checked)}
          right={renderSource('enableTtsProvidersTab')}
          variant="flat"
        />
        <ToggleRow
          label="Show all provider models"
          description="Allow model selection beyond defaults."
          checked={Boolean(draft.showAllProviderModels)}
          onChange={(checked) => updateDraft('showAllProviderModels', checked)}
          right={renderSource('showAllProviderModels')}
          variant="flat"
        />
      </Section>

      <Section
        title="Rate limiting"
        subtitle="Daily TTS quotas, PDF parsing throttle, and upload size."
        action={<Badge tone="foreground">Limits</Badge>}
      >
        <ToggleRow
          label="Disable TTS daily rate limiting"
          description="When on, per-user/IP daily character quotas are not enforced."
          checked={Boolean(draft.disableTtsRateLimit)}
          onChange={(checked) => updateDraft('disableTtsRateLimit', checked)}
          right={renderSource('disableTtsRateLimit')}
          variant="flat"
        />
        {shouldRenderRateLimitInputs ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 px-0.5 py-1.5">
            <div className="space-y-1">
              <div className="flex items-center justify-between gap-2">
                <label className="text-xs font-medium text-foreground">Anonymous per-user daily limit</label>
                {renderSource('ttsDailyLimitAnonymous')}
              </div>
              <Input
                type="number"
                min={1}
                step={1}
                value={String(draft.ttsDailyLimitAnonymous ?? '')}
                onChange={(event) => updatePositiveIntDraft('ttsDailyLimitAnonymous', event.target.value)}
              />
            </div>
            <div className="space-y-1">
              <div className="flex items-center justify-between gap-2">
                <label className="text-xs font-medium text-foreground">Authenticated per-user daily limit</label>
                {renderSource('ttsDailyLimitAuthenticated')}
              </div>
              <Input
                type="number"
                min={1}
                step={1}
                value={String(draft.ttsDailyLimitAuthenticated ?? '')}
                onChange={(event) => updatePositiveIntDraft('ttsDailyLimitAuthenticated', event.target.value)}
              />
            </div>
            <div className="space-y-1">
              <div className="flex items-center justify-between gap-2">
                <label className="text-xs font-medium text-foreground">Anonymous IP daily backstop</label>
                {renderSource('ttsIpDailyLimitAnonymous')}
              </div>
              <Input
                type="number"
                min={1}
                step={1}
                value={String(draft.ttsIpDailyLimitAnonymous ?? '')}
                onChange={(event) => updatePositiveIntDraft('ttsIpDailyLimitAnonymous', event.target.value)}
              />
            </div>
            <div className="space-y-1">
              <div className="flex items-center justify-between gap-2">
                <label className="text-xs font-medium text-foreground">Authenticated IP daily backstop</label>
                {renderSource('ttsIpDailyLimitAuthenticated')}
              </div>
              <Input
                type="number"
                min={1}
                step={1}
                value={String(draft.ttsIpDailyLimitAuthenticated ?? '')}
                onChange={(event) => updatePositiveIntDraft('ttsIpDailyLimitAuthenticated', event.target.value)}
              />
            </div>
          </div>
        ) : null}

        <ToggleRow
          label="Disable PDF parsing rate limiting"
          description="When on, per-user limits on starting PDF layout parses are not enforced."
          checked={Boolean(draft.disableComputeRateLimit)}
          onChange={(checked) => updateDraft('disableComputeRateLimit', checked)}
          right={renderSource('disableComputeRateLimit')}
          variant="flat"
        />
        {shouldRenderComputeRateLimitInputs ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 px-0.5 py-1.5">
            <div className="space-y-1">
              <div className="flex items-center justify-between gap-2">
                <label className="text-xs font-medium text-foreground">Burst limit (parses)</label>
                {renderSource('computeParseBurstMax')}
              </div>
              <Input
                type="number"
                min={1}
                step={1}
                value={String(draft.computeParseBurstMax ?? '')}
                onChange={(event) => updatePositiveIntDraft('computeParseBurstMax', event.target.value)}
              />
            </div>
            <div className="space-y-1">
              <div className="flex items-center justify-between gap-2">
                <label className="text-xs font-medium text-foreground">Burst window (seconds)</label>
                {renderSource('computeParseBurstWindowSec')}
              </div>
              <Input
                type="number"
                min={1}
                step={1}
                value={String(draft.computeParseBurstWindowSec ?? '')}
                onChange={(event) => updatePositiveIntDraft('computeParseBurstWindowSec', event.target.value)}
              />
            </div>
            <div className="space-y-1">
              <div className="flex items-center justify-between gap-2">
                <label className="text-xs font-medium text-foreground">Sustained limit (parses)</label>
                {renderSource('computeParseSustainedMax')}
              </div>
              <Input
                type="number"
                min={1}
                step={1}
                value={String(draft.computeParseSustainedMax ?? '')}
                onChange={(event) => updatePositiveIntDraft('computeParseSustainedMax', event.target.value)}
              />
            </div>
            <div className="space-y-1">
              <div className="flex items-center justify-between gap-2">
                <label className="text-xs font-medium text-foreground">Sustained window (seconds)</label>
                {renderSource('computeParseSustainedWindowSec')}
              </div>
              <Input
                type="number"
                min={1}
                step={1}
                value={String(draft.computeParseSustainedWindowSec ?? '')}
                onChange={(event) => updatePositiveIntDraft('computeParseSustainedWindowSec', event.target.value)}
              />
            </div>
          </div>
        ) : null}

        <div className="px-0.5 pt-1 pb-2 border-b border-offbase last:border-b-0">
          <div className="flex items-center gap-2.5">
            <div className="flex-1 min-w-0 space-y-0.5">
              <span className="block text-sm font-medium leading-5 text-foreground">Max upload size</span>
              <span className="block text-xs leading-4 text-muted">Largest single document upload accepted.</span>
            </div>
            <div className="shrink-0 self-start pl-1.5">{renderSource('maxUploadMb')}</div>
            <div className="shrink-0 flex items-center gap-1.5">
              <Input
                type="number"
                min={1}
                step={1}
                inputMode="numeric"
                aria-label="Max upload size in megabytes"
                className="w-20 text-right"
                value={String(draft.maxUploadMb ?? '')}
                onChange={(event) => updatePositiveIntDraft('maxUploadMb', event.target.value)}
              />
              <span className="text-xs text-muted">MB</span>
            </div>
          </div>
        </div>
      </Section>

      <Section
        title="Site features"
        subtitle="Feature flags for all users."
        action={<Badge tone="foreground">Feature Flags</Badge>}
      >
        <div className="space-y-1.5 pb-2 border-b border-offbase">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">Changelog feed URL</p>
              <p className="text-xs text-muted mt-0.5">
                Public URL to the changelog manifest JSON used by Settings.
              </p>
            </div>
            <div className="shrink-0">{renderSource('changelogFeedUrl')}</div>
          </div>
          <Input
            type="text"
            value={String(draft.changelogFeedUrl ?? '')}
            onChange={(event) => updateDraft('changelogFeedUrl', event.target.value)}
            placeholder="https://docs.openreader.richardr.dev/changelog/manifest.json"
          />
        </div>
        <ToggleRow
          label="Allow new account sign-ups"
          description="When off, new accounts cannot be created. Existing accounts can still sign in."
          checked={Boolean(draft.enableUserSignups)}
          onChange={(checked) => updateDraft('enableUserSignups', checked)}
          right={renderSource('enableUserSignups')}
          variant="flat"
        />
        <ToggleRow
          label="Audiobook export"
          description='Show "Export audiobook" on PDF/EPUB pages.'
          checked={Boolean(draft.enableAudiobookExport)}
          onChange={(checked) => updateDraft('enableAudiobookExport', checked)}
          right={renderSource('enableAudiobookExport')}
          variant="flat"
        />
        <ToggleRow
          label="DOCX upload conversion"
          description="Allow DOCX uploads (converted to PDF)."
          checked={Boolean(draft.enableDocxConversion)}
          onChange={(checked) => updateDraft('enableDocxConversion', checked)}
          right={renderSource('enableDocxConversion')}
          variant="flat"
        />
      </Section>

      <Section
        title="TTS upstream"
        subtitle="Server-side retry, timeout, and cache controls for TTS generation."
        action={<Badge tone="foreground">Upstream</Badge>}
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 px-0.5 py-1.5">
          <div className="space-y-1">
            <div className="flex items-center justify-between gap-2">
              <label className="text-xs font-medium text-foreground">Retry attempts</label>
              {renderSource('ttsUpstreamMaxRetries')}
            </div>
            <Input
              type="number"
              min={1}
              step={1}
              value={String(draft.ttsUpstreamMaxRetries ?? '')}
              onChange={(event) => updatePositiveIntDraft('ttsUpstreamMaxRetries', event.target.value)}
            />
          </div>
          <div className="space-y-1">
            <div className="flex items-center justify-between gap-2">
              <label className="text-xs font-medium text-foreground">Upstream timeout (ms)</label>
              {renderSource('ttsUpstreamTimeoutMs')}
            </div>
            <Input
              type="number"
              min={1}
              step={1}
              value={String(draft.ttsUpstreamTimeoutMs ?? '')}
              onChange={(event) => updatePositiveIntDraft('ttsUpstreamTimeoutMs', event.target.value)}
            />
          </div>
          <div className="space-y-1">
            <div className="flex items-center justify-between gap-2">
              <label className="text-xs font-medium text-foreground">Audio cache size (bytes)</label>
              {renderSource('ttsCacheMaxSizeBytes')}
            </div>
            <Input
              type="number"
              min={1}
              step={1}
              value={String(draft.ttsCacheMaxSizeBytes ?? '')}
              onChange={(event) => updatePositiveIntDraft('ttsCacheMaxSizeBytes', event.target.value)}
            />
          </div>
          <div className="space-y-1">
            <div className="flex items-center justify-between gap-2">
              <label className="text-xs font-medium text-foreground">Audio cache TTL (ms)</label>
              {renderSource('ttsCacheTtlMs')}
            </div>
            <Input
              type="number"
              min={1}
              step={1}
              value={String(draft.ttsCacheTtlMs ?? '')}
              onChange={(event) => updatePositiveIntDraft('ttsCacheTtlMs', event.target.value)}
            />
          </div>
        </div>
      </Section>

      <Section
        title="Audiobookshelf & AI Integration"
        subtitle="Directly export generated audiobooks and companion documents to Audiobookshelf."
        action={<Badge tone="accent">Audiobookshelf</Badge>}
      >
        <div className="space-y-3">
          <div className="space-y-1">
            <div className="flex items-center justify-between gap-2">
              <label className="text-xs font-medium text-foreground">Audiobookshelf Server URL</label>
              {renderSource('audiobookshelfUrl')}
            </div>
            <Input
              type="text"
              placeholder="http://192.168.90.244:13378"
              value={String(draft.audiobookshelfUrl ?? '')}
              onChange={(e) => updateDraft('audiobookshelfUrl', e.target.value)}
            />
          </div>

          <div className="space-y-1">
            <div className="flex items-center justify-between gap-2">
              <label className="text-xs font-medium text-foreground">Audiobookshelf API Token</label>
              {renderSource('audiobookshelfToken')}
            </div>
            <div className="flex gap-2">
              <Input
                type={showAbsToken ? 'text' : 'password'}
                placeholder="Enter API token..."
                value={String(draft.audiobookshelfToken ?? '')}
                onChange={(e) => updateDraft('audiobookshelfToken', e.target.value)}
              />
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => setShowAbsToken((s) => !s)}
                className="shrink-0"
              >
                {showAbsToken ? 'Hide' : 'Show'}
              </Button>
            </div>
            <p className="text-[11px] text-muted">
              Generate an API token in Audiobookshelf (Settings &gt; Users &gt; API Tokens).
            </p>
          </div>

          <div className="flex items-center gap-3 pt-1">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={isTestingAbs || !draft.audiobookshelfUrl || !draft.audiobookshelfToken}
              onClick={handleTestAbsConnection}
            >
              {isTestingAbs ? 'Testing...' : 'Test Connection & Fetch Libraries'}
            </Button>
            {absTestStatus === 'success' && (
              <span className="text-xs text-emerald-500 font-medium flex items-center gap-1">
                ✓ Connected successfully ({absLibraries.length} {absLibraries.length === 1 ? 'library' : 'libraries'} found)
              </span>
            )}
            {absTestStatus === 'error' && (
              <span className="text-xs text-rose-500 font-medium">
                ✗ {absTestError}
              </span>
            )}
          </div>

          {absLibraries.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
              <div className="space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <label className="text-xs font-medium text-foreground">Default Target Library</label>
                  {renderSource('audiobookshelfLibraryId')}
                </div>
                <select
                  className="w-full rounded-md border border-line-soft bg-background px-3 py-2 text-xs text-foreground outline-none focus:border-accent"
                  value={String(draft.audiobookshelfLibraryId ?? '')}
                  onChange={(e) => {
                    const libId = e.target.value;
                    updateDraft('audiobookshelfLibraryId', libId);
                    const lib = absLibraries.find((l) => l.id === libId);
                    if (lib && lib.folders.length > 0) {
                      updateDraft('audiobookshelfFolderId', lib.folders[0].id);
                    }
                  }}
                >
                  <option value="">Select a library...</option>
                  {absLibraries.map((lib) => (
                    <option key={lib.id} value={lib.id}>
                      {lib.name} ({lib.mediaType})
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <label className="text-xs font-medium text-foreground">Default Folder</label>
                  {renderSource('audiobookshelfFolderId')}
                </div>
                <select
                  className="w-full rounded-md border border-line-soft bg-background px-3 py-2 text-xs text-foreground outline-none focus:border-accent"
                  value={String(draft.audiobookshelfFolderId ?? '')}
                  onChange={(e) => updateDraft('audiobookshelfFolderId', e.target.value)}
                  disabled={!currentLibraryFolders.length}
                >
                  {currentLibraryFolders.length === 0 ? (
                    <option value="">(Select library first)</option>
                  ) : (
                    currentLibraryFolders.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.fullPath}
                      </option>
                    ))
                  )}
                </select>
              </div>
            </div>
          )}

          <ToggleRow
            label="Infer document metadata with Gemini"
            description="Automatically detect clean canonical book title, author, and series when exporting to Audiobookshelf."
            checked={Boolean(draft.audiobookshelfAutoDetectMetadata ?? true)}
            onChange={(checked) => updateDraft('audiobookshelfAutoDetectMetadata', checked)}
            right={renderSource('audiobookshelfAutoDetectMetadata')}
            variant="flat"
          />

          <div className="space-y-1 pt-2 border-t border-line-soft">
            <div className="flex items-center justify-between gap-2">
              <label className="text-xs font-medium text-foreground">Admin Universal Gemini API Key</label>
              {renderSource('geminiApiKey')}
            </div>
            <div className="flex gap-2">
              <Input
                type={showGeminiKey ? 'text' : 'password'}
                placeholder="AIzaSy..."
                value={String(draft.geminiApiKey ?? '')}
                onChange={(e) => updateDraft('geminiApiKey', e.target.value)}
              />
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => setShowGeminiKey((s) => !s)}
                className="shrink-0"
              >
                {showGeminiKey ? 'Hide' : 'Show'}
              </Button>
            </div>
            <p className="text-[11px] text-muted">
              Used by Gemini 3.8 Flash to intelligently determine clean titles, author, and series for strange/raw filenames, and serves as server fallback for Smart Audio.
            </p>
          </div>
        </div>
      </Section>

      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted">
          {dirty.size > 0
            ? `${dirty.size} unsaved change${dirty.size === 1 ? '' : 's'}`
            : 'No unsaved changes'}
        </p>
        <div className="flex gap-2">
          <Button
            onClick={discardAll}
            disabled={dirty.size === 0 || saving}
            variant="secondary"
            size="sm"
          >
            Discard
          </Button>
          <Button
            onClick={saveAll}
            disabled={dirty.size === 0 || saving}
            variant="primary"
            size="sm"
          >
            {saving ? 'Saving…' : dirty.size > 0 ? `Save (${dirty.size})` : 'Save'}
          </Button>
        </div>
      </div>
    </div>
  );
}

function AdminFeaturesSkeleton() {
  return (
    <div className="space-y-4 animate-pulse" aria-label="Loading feature settings" aria-busy="true">
      <Section
        title="TTS defaults"
        subtitle="Defaults for new users."
        action={<div className="h-4 w-16 rounded bg-offbase" />}
      >
        <div className="space-y-1.5 pb-2 border-b border-offbase">
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1 min-w-0">
              <div className="h-4 w-40 rounded bg-offbase" />
              <div className="h-3 w-56 rounded bg-offbase" />
            </div>
            <div className="h-5 w-20 rounded bg-offbase" />
          </div>
          <div className="h-9 w-full rounded-md bg-offbase" />
        </div>
        <div className="space-y-2">
          <div className="h-14 w-full rounded-md border border-offbase bg-background" />
          <div className="h-14 w-full rounded-md border border-offbase bg-background" />
          <div className="h-14 w-full rounded-md border border-offbase bg-background" />
        </div>
      </Section>

      <Section
        title="Site features"
        subtitle="Feature flags for all users."
        action={<div className="h-4 w-24 rounded bg-offbase" />}
      >
        <div className="space-y-2">
          <div className="h-14 w-full rounded-md border border-offbase bg-background" />
          <div className="h-14 w-full rounded-md border border-offbase bg-background" />
          <div className="h-14 w-full rounded-md border border-offbase bg-background" />
        </div>
      </Section>
    </div>
  );
}

function SourceBadge({
  source,
  dirty,
  canReset,
  onReset,
  saving,
}: {
  source: RuntimeConfigSource;
  dirty: boolean;
  canReset: boolean;
  onReset: () => void;
  saving: boolean;
}) {
  return (
    <div className="flex items-center gap-1.5">
      {canReset && !dirty && (
        <Button
          type="button"
          variant="ghost"
          size="xs"
          onClick={onReset}
          disabled={saving}
          className="h-auto px-1 py-0 text-[11px] font-medium text-muted hover:text-accent"
        >
          Reset
        </Button>
      )}
      {dirty ? (
        <Badge tone="accent">Modified</Badge>
      ) : source === 'json-seed' ? (
        <Badge tone="muted">from seed</Badge>
      ) : source === 'env-seed' ? (
        <Badge tone="muted">from env</Badge>
      ) : source === 'admin' ? (
        <Badge tone="foreground">admin</Badge>
      ) : (
        <Badge tone="muted">default</Badge>
      )}
    </div>
  );
}
