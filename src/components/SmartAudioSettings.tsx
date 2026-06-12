/* eslint-disable no-restricted-syntax */
"use client";

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { BASE_ABBREVIATIONS, BASE_BOOKS, PRESET_MODELS, PRESET_PROMPTS } from './constants';
import type { SmartAudioProfile } from '@/types/client';

const EMPTY_PROFILE = (): SmartAudioProfile => ({
  id: `profile-${Date.now()}`,
  name: 'New Profile',
  aiModel: PRESET_MODELS[0]?.id || 'gemini-2.5-flash',
  customTtsPrompt: '',
  abbreviations: {},
  pronunciations: {},
  books: {},
});

function objectToEntries(value: Record<string, string>): Array<{ key: string; value: string }> {
  return Object.entries(value).map(([key, val]) => ({ key, value: val }));
}

function entriesToObject(entries: Array<{ key: string; value: string }>): Record<string, string> {
  return entries.reduce<Record<string, string>>((acc, entry) => {
    const key = entry.key.trim();
    const value = entry.value.trim();
    if (!key || !value) return acc;
    acc[key] = value;
    return acc;
  }, {});
}

export function SmartAudioSettings() {
  const [apiKey, setApiKey] = useState('');
  const [maskedKey, setMaskedKey] = useState<string | null>(null);
  const [profiles, setProfiles] = useState<SmartAudioProfile[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState<string>('');
  const [profileName, setProfileName] = useState('');
  const [aiModel, setAiModel] = useState(PRESET_MODELS[0]?.id || 'gemini-2.5-flash');
  const [customModelId, setCustomModelId] = useState('');
  const [promptMode, setPromptMode] = useState<'preset' | 'custom'>('preset');
  const [selectedPromptName, setSelectedPromptName] = useState<string>(PRESET_PROMPTS[0]?.name || '');
  const [prompt, setPrompt] = useState('');
  const [abbreviations, setAbbreviations] = useState(BASE_ABBREVIATIONS.map(({ key, value }) => ({ key, value })));
  const [pronunciations, setPronunciations] = useState<Array<{ key: string; value: string }>>([]);
  const [books, setBooks] = useState(BASE_BOOKS.map(({ key, value }) => ({ key, value })));
  const [selectedAbbrevs, setSelectedAbbrevs] = useState<number[]>([]);
  const [selectedPronuns, setSelectedPronuns] = useState<number[]>([]);
  const [selectedBooks, setSelectedBooks] = useState<number[]>([]);
  const [newAbbrev, setNewAbbrev] = useState({ key: '', value: '' });
  const [newPronun, setNewPronun] = useState({ key: '', value: '' });
  const [newBook, setNewBook] = useState({ key: '', value: '' });
  const [isLoading, setIsLoading] = useState(true);

  const activeProfile = useMemo(
    () => profiles.find((profile) => profile.id === selectedProfileId) || profiles[0] || null,
    [profiles, selectedProfileId],
  );

  const loadProfiles = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await fetch('/api/tts-settings');
      const data = await response.json();
      setMaskedKey(data.maskedKey ?? null);
      setProfiles(Array.isArray(data.smartAudioProfiles) ? data.smartAudioProfiles : []);
      const nextSelected = typeof data.selectedSmartAudioProfileId === 'string' && data.selectedSmartAudioProfileId
        ? data.selectedSmartAudioProfileId
        : (Array.isArray(data.smartAudioProfiles) && data.smartAudioProfiles[0]?.id) || '';
      setSelectedProfileId(nextSelected);
      if (typeof data.selectedSmartAudioProfileId === 'string' && data.selectedSmartAudioProfileId) {
        setSelectedProfileId(data.selectedSmartAudioProfileId);
      }
    } catch (error) {
      console.error('Failed to load smart-audio settings:', error);
      const fallback = EMPTY_PROFILE();
      setProfiles([fallback]);
      setSelectedProfileId(fallback.id);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadProfiles();
  }, [loadProfiles]);

  useEffect(() => {
    if (!activeProfile) return;
    setProfileName(activeProfile.name);
    setAiModel(activeProfile.aiModel || PRESET_MODELS[0]?.id || 'gemini-2.5-flash');
    setCustomModelId(activeProfile.aiModel && PRESET_MODELS.some((model) => model.id === activeProfile.aiModel) ? '' : activeProfile.aiModel);
    const matchedPreset = PRESET_PROMPTS.find((preset) => preset.content.trim() === (activeProfile.customTtsPrompt || '').trim());
    if (matchedPreset) {
      setPromptMode('preset');
      setSelectedPromptName(matchedPreset.name);
      setPrompt(matchedPreset.content);
    } else {
      setPromptMode('custom');
      setSelectedPromptName('');
      setPrompt(activeProfile.customTtsPrompt || '');
    }
    setAbbreviations(objectToEntries(activeProfile.abbreviations || {}));
    setPronunciations(objectToEntries(activeProfile.pronunciations || {}));
    setBooks(objectToEntries(activeProfile.books || {}));
    // Load this profile's key — show masked placeholder if already saved
    setApiKey('');
    setMaskedKey(activeProfile.geminiApiKey ? `••••••••••••${activeProfile.geminiApiKey.slice(-4)}` : null);
  }, [activeProfile]);

  const buildCurrentProfile = useCallback((): SmartAudioProfile | null => {
    const finalModel = aiModel === 'custom' ? customModelId.trim() : aiModel;
    if (!profileName.trim()) return null;
    if (aiModel === 'custom' && !finalModel) return null;
    return {
      id: selectedProfileId || EMPTY_PROFILE().id,
      name: profileName.trim(),
      aiModel: finalModel || PRESET_MODELS[0]?.id || 'gemini-2.5-flash',
      customTtsPrompt: prompt,
      abbreviations: entriesToObject(abbreviations),
      pronunciations: entriesToObject(pronunciations),
      books: entriesToObject(books),
      // Preserve stored key; overwrite only if user typed a new one
      geminiApiKey: apiKey.trim() || activeProfile?.geminiApiKey || undefined,
    };
  }, [apiKey, aiModel, customModelId, profileName, selectedProfileId, prompt, abbreviations, pronunciations, books, activeProfile]);

  const handleNewProfile = useCallback(() => {
    const profile = EMPTY_PROFILE();
    setProfiles((current) => [profile, ...current]);
    setSelectedProfileId(profile.id);
    setProfileName(profile.name);
    setAiModel(profile.aiModel);
    setCustomModelId('');
    setPrompt(profile.customTtsPrompt);
    setAbbreviations([]);
    setPronunciations([]);
    setBooks([]);
  }, []);

  const handleDuplicateProfile = useCallback(() => {
    const current = buildCurrentProfile();
    if (!current) return;
    const duplicate: SmartAudioProfile = {
      ...current,
      id: `${current.id}-copy-${Date.now()}`,
      name: `${current.name} Copy`,
    };
    setProfiles((existing) => [duplicate, ...existing]);
    setSelectedProfileId(duplicate.id);
    setProfileName(duplicate.name);
  }, [buildCurrentProfile]);

  const handleDeleteProfile = useCallback(() => {
    if (!selectedProfileId) return;
    const nextProfiles = profiles.filter((profile) => profile.id !== selectedProfileId);
    const fallback = nextProfiles[0] || EMPTY_PROFILE();
    setProfiles(nextProfiles.length > 0 ? nextProfiles : [fallback]);
    setSelectedProfileId(nextProfiles[0]?.id || fallback.id);
  }, [profiles, selectedProfileId]);

  const handleSave = useCallback(async () => {
    const current = buildCurrentProfile();
    if (!current) {
      alert('Please enter a profile name before saving.');
      return;
    }

    const nextProfiles = profiles.some((profile) => profile.id === current.id)
      ? profiles.map((profile) => (profile.id === current.id ? current : profile))
      : [current, ...profiles];

    try {
      const response = await fetch('/api/tts-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          // Key is now embedded inside each profile object, not sent globally
          smartAudioProfiles: nextProfiles,
          selectedSmartAudioProfileId: current.id,
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to save smart audio settings');
      }

      setProfiles(nextProfiles);
      setSelectedProfileId(current.id);
      if (apiKey) {
        setMaskedKey(`••••••••••••${apiKey.slice(-4)}`);
        setApiKey('');
      }
      alert('Smart audio profile saved.');
    } catch (error) {
      console.error('Error saving smart audio settings:', error);
      alert('Failed to save smart audio settings. Check the server logs.');
    }
  }, [apiKey, buildCurrentProfile, profiles]);

  const handleProfileChange = useCallback((nextProfileId: string) => {
    setSelectedProfileId(nextProfileId);
  }, []);

  const downloadCSV = (items: { key: string; value: string }[], filename: string) => {
    const csvContent = items.map(i => `${i.key},${i.value}`).join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
  };

  const handleCSVUpload = (
    e: React.ChangeEvent<HTMLInputElement>,
    currentItems: { key: string; value: string }[],
    setItems: (items: { key: string; value: string }[]) => void
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const newItems = text.split('\n').map((line) => {
        const [key, value] = line.split(',');
        return { key: key?.trim(), value: value?.trim() };
      }).filter((item) => item.key && item.value);

      if (currentItems.length > 0) {
        const wantsOverwrite = window.confirm('Click OK to OVERWRITE the current list, or Cancel to APPEND the new items to the bottom of the list.');
        if (wantsOverwrite) {
          const confirmOverwrite = window.confirm('You have chosen to overwrite. Are you sure you want to completely replace your current list? This cannot be undone.');
          if (confirmOverwrite) {
            setItems(newItems);
          }
        } else {
          setItems([...currentItems, ...newItems]);
        }
      } else {
        setItems(newItems);
      }
      e.target.value = '';
    };
    reader.readAsText(file);
  };

  const handleAddAbbrev = () => {
    if (!newAbbrev.key || !newAbbrev.value) return;
    setAbbreviations([...abbreviations, newAbbrev]);
    setNewAbbrev({ key: '', value: '' });
  };

  const handleAddPronun = () => {
    if (!newPronun.key || !newPronun.value) return;
    setPronunciations([...pronunciations, newPronun]);
    setNewPronun({ key: '', value: '' });
  };

  const handleAddBook = () => {
    if (!newBook.key || !newBook.value) return;
    setBooks([...books, newBook]);
    setNewBook({ key: '', value: '' });
  };

  const handlePromptModeChange = useCallback((mode: 'preset' | 'custom') => {
    setPromptMode(mode);
    if (mode === 'custom') {
      setSelectedPromptName('');
      return;
    }

    const preset = PRESET_PROMPTS.find((item) => item.name === selectedPromptName) || PRESET_PROMPTS[0];
    if (preset) {
      setSelectedPromptName(preset.name);
      setPrompt(preset.content);
    }
  }, [selectedPromptName]);

  const handlePromptPresetChange = useCallback((presetName: string) => {
    setSelectedPromptName(presetName);
    const preset = PRESET_PROMPTS.find((item) => item.name === presetName);
    if (!preset) return;
    setPromptMode('preset');
    setPrompt(preset.content);
  }, []);

  const finalModel = aiModel === 'custom' ? customModelId.trim() : aiModel;

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-8 bg-white dark:bg-gray-900 rounded-lg shadow-sm border border-gray-200 dark:border-gray-800">
      <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
        <div>
          <h2 className="text-2xl font-bold mb-1">Smart AI Profiles</h2>
          <p className="text-gray-500 text-sm">
            Create reusable Smart Audio presets for audiobook generation.
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={handleNewProfile} className="px-3 py-2 rounded bg-gray-100 dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-sm font-medium">
            New profile
          </button>
          <button onClick={handleDuplicateProfile} className="px-3 py-2 rounded bg-blue-50 hover:bg-blue-100 dark:bg-blue-900/30 dark:hover:bg-blue-900/50 border border-blue-200 dark:border-blue-800 text-sm font-medium text-blue-700 dark:text-blue-300 transition-colors">
            Duplicate
          </button>
          <button onClick={handleDeleteProfile} className="px-3 py-2 rounded bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 text-sm font-medium text-red-700 dark:text-red-300">
            Delete
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="space-y-4 p-4 border rounded dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
          <div className="space-y-2">
            <label className="block text-sm font-semibold">Profile</label>
            <select
              className="w-full p-2 border rounded bg-gray-50 dark:bg-gray-800 dark:border-gray-700 text-gray-900 dark:text-gray-100 cursor-pointer"
              value={selectedProfileId}
              onChange={(e) => handleProfileChange(e.target.value)}
              disabled={isLoading}
            >
              {profiles.map((profile) => (
                <option key={profile.id} value={profile.id}>{profile.name}</option>
              ))}
              {profiles.length === 0 && <option value="">No profiles found</option>}
            </select>
            <input
              type="text"
              className="w-full p-2 border rounded bg-white dark:bg-gray-900 border-gray-300 dark:border-gray-700 text-gray-900 dark:text-gray-100"
              placeholder="Profile name"
              value={profileName}
              onChange={(e) => setProfileName(e.target.value)}
            />
            <p className="text-xs text-gray-400">This name appears in the audiobook generator profile selector.</p>
          </div>

          <div className="space-y-2">
            <div className="flex justify-between items-end gap-2">
              <label className="block text-sm font-semibold">Google Gemini API Key</label>
              {maskedKey && (
                <span className="text-xs font-mono bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400 px-2 py-0.5 rounded">Active: {maskedKey}</span>
              )}
            </div>
            <input
              type="password"
              className="w-full p-2 border rounded bg-gray-50 dark:bg-gray-800 dark:border-gray-700 text-gray-900 dark:text-gray-100"
              placeholder={maskedKey ? 'Enter a new key to overwrite...' : 'Enter your API key...'}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
            />
            <p className="text-xs text-gray-400">
              {maskedKey ? 'Leave blank to keep using the saved key for this profile.' : 'Required. This key is saved securely to this specific profile.'}
            </p>
          </div>
        </div>

        <div className="space-y-4 p-4 border rounded dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 lg:col-span-2">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-3">
              <label className="block text-sm font-semibold">AI Processing Model</label>
              <select
                className="w-full p-2 border rounded bg-gray-50 dark:bg-gray-800 dark:border-gray-700 text-gray-900 dark:text-gray-100 cursor-pointer"
                value={aiModel}
                onChange={(e) => setAiModel(e.target.value)}
              >
                {PRESET_MODELS.map((model) => (
                  <option key={model.id} value={model.id}>{model.name}</option>
                ))}
                <option value="custom">Custom...</option>
              </select>
              {aiModel === 'custom' && (
                <input
                  type="text"
                  className="w-full p-2 border rounded bg-white dark:bg-gray-900 border-blue-400 dark:border-blue-500 text-gray-900 dark:text-gray-100 placeholder-gray-400 text-sm font-mono shadow-inner"
                  placeholder="e.g., gemini-1.5-pro-tuning-v2"
                  value={customModelId}
                  onChange={(e) => setCustomModelId(e.target.value)}
                />
              )}
              <p className="text-xs text-gray-400">Select or enter the Gemini model used by the worker.</p>
            </div>

            <div className="space-y-3">
              <label className="block text-sm font-semibold">Profile Summary</label>
              <div className="rounded border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-3 text-sm text-gray-600 dark:text-gray-300 space-y-1">
                <div><span className="font-medium text-gray-900 dark:text-gray-100">Profile id:</span> {selectedProfileId || 'unset'}</div>
                <div><span className="font-medium text-gray-900 dark:text-gray-100">Model:</span> {finalModel || 'unset'}</div>
                <div><span className="font-medium text-gray-900 dark:text-gray-100">Abbreviations:</span> {abbreviations.length}</div>
                <div><span className="font-medium text-gray-900 dark:text-gray-100">Pronunciations:</span> {pronunciations.length}</div>
                <div><span className="font-medium text-gray-900 dark:text-gray-100">Books:</span> {books.length}</div>
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex items-end justify-between gap-3 flex-wrap">
              <label className="block text-sm font-semibold">Prompt</label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => handlePromptModeChange('preset')}
                  className={`px-3 py-1.5 rounded border text-xs font-medium ${promptMode === 'preset' ? 'bg-accent text-background border-accent' : 'bg-surface text-foreground border-line hover:bg-accent-wash'}`}
                >
                  Choose template
                </button>
                <button
                  type="button"
                  onClick={() => handlePromptModeChange('custom')}
                  className={`px-3 py-1.5 rounded border text-xs font-medium ${promptMode === 'custom' ? 'bg-accent text-background border-accent' : 'bg-surface text-foreground border-line hover:bg-accent-wash'}`}
                >
                  Write custom
                </button>
              </div>
            </div>

            {promptMode === 'preset' ? (
              <div className="space-y-3">
                <select
                  className="w-full p-2 border rounded bg-surface-sunken dark:bg-gray-800 dark:border-gray-700 text-foreground cursor-pointer"
                  value={selectedPromptName}
                  onChange={(e) => handlePromptPresetChange(e.target.value)}
                >
                  {PRESET_PROMPTS.map((preset) => (
                    <option key={preset.name} value={preset.name}>{preset.name}</option>
                  ))}
                </select>
                <textarea
                  className="w-full h-44 p-3 border rounded bg-surface-sunken dark:bg-gray-800 dark:border-gray-700 text-foreground font-mono text-sm leading-relaxed"
                  value={prompt}
                  readOnly
                />
                <p className="text-xs text-soft">
                  Pick a template to start from. Switch to custom to edit the prompt by hand.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                <textarea
                  className="w-full h-44 p-3 border rounded bg-surface-sunken dark:bg-gray-800 dark:border-gray-700 text-foreground font-mono text-sm leading-relaxed"
                  placeholder="Enter your specific formatting rules here..."
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                />
                <p className="text-xs text-soft">
                  This custom prompt will be saved in the selected profile.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        <div className="space-y-4 p-4 border rounded dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
          <div className="flex flex-col gap-3 mb-2">
            <div>
              <h3 className="font-semibold text-lg">Abbreviations</h3>
              <p className="text-xs text-gray-500">Static text expansion.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button onClick={() => downloadCSV(abbreviations, 'abbreviations.csv')} className="text-xs bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 px-2 py-1 rounded cursor-pointer hover:bg-blue-200">Export</button>
              <button onClick={() => setAbbreviations(BASE_ABBREVIATIONS.map(({ key, value }) => ({ key, value })))} className="text-xs bg-yellow-100 dark:bg-yellow-900 text-yellow-800 dark:text-yellow-200 px-2 py-1 rounded cursor-pointer hover:bg-yellow-200">Reset</button>
              <label className="text-xs bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 px-2 py-1 rounded cursor-pointer hover:bg-gray-300 dark:hover:bg-gray-600">
                Import CSV
                <input type="file" accept=".csv" className="hidden" onChange={(e) => handleCSVUpload(e, abbreviations, setAbbreviations)} />
              </label>
            </div>
          </div>
          <div className="flex gap-2">
            <input type="text" placeholder="Short (e.g. NT)" className="w-1/2 p-2 text-sm border rounded bg-white dark:bg-gray-900 dark:border-gray-700 text-gray-900 dark:text-gray-100" value={newAbbrev.key} onChange={(e) => setNewAbbrev({ ...newAbbrev, key: e.target.value })} />
            <input type="text" placeholder="Expanded" className="w-1/2 p-2 text-sm border rounded bg-white dark:bg-gray-900 dark:border-gray-700 text-gray-900 dark:text-gray-100" value={newAbbrev.value} onChange={(e) => setNewAbbrev({ ...newAbbrev, value: e.target.value })} />
            <button onClick={handleAddAbbrev} className="px-3 bg-blue-600 hover:bg-blue-700 text-white rounded font-bold shadow-sm">+</button>
          </div>
          <ul className="space-y-2 mt-4 max-h-96 overflow-y-auto pr-2">
            {abbreviations.map((item, idx) => (
              <li key={`${item.key}-${idx}`} className="flex items-center gap-3 text-sm bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-800 dark:text-gray-200 p-2 rounded shadow-sm">
                <input type="checkbox" checked={selectedAbbrevs.includes(idx)} onChange={(e) => {
                  if (e.target.checked) setSelectedAbbrevs([...selectedAbbrevs, idx]);
                  else setSelectedAbbrevs(selectedAbbrevs.filter((i) => i !== idx));
                }} />
                <span className="flex-1"><strong>{item.key}</strong> &rarr; {item.value}</span>
              </li>
            ))}
          </ul>
          <button onClick={() => { setAbbreviations(abbreviations.filter((_, i) => !selectedAbbrevs.includes(i))); setSelectedAbbrevs([]); }} className="text-xs text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 font-bold">Delete Selected</button>
        </div>

        <div className="space-y-4 p-4 border rounded dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
          <div className="flex flex-col gap-3 mb-2">
            <div>
              <h3 className="font-semibold text-lg">Pronunciations</h3>
              <p className="text-xs text-gray-500">Force specific phonetics.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button onClick={() => downloadCSV(pronunciations, 'pronunciations.csv')} className="text-xs bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 px-2 py-1 rounded cursor-pointer hover:bg-blue-200">Export</button>
              <label className="text-xs bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 px-2 py-1 rounded cursor-pointer hover:bg-gray-300 dark:hover:bg-gray-600">
                Import CSV
                <input type="file" accept=".csv" className="hidden" onChange={(e) => handleCSVUpload(e, pronunciations, setPronunciations)} />
              </label>
            </div>
          </div>
          <div className="flex gap-2">
            <input type="text" placeholder="Word" className="w-1/2 p-2 text-sm border rounded bg-white dark:bg-gray-900 dark:border-gray-700 text-gray-900 dark:text-gray-100" value={newPronun.key} onChange={(e) => setNewPronun({ ...newPronun, key: e.target.value })} />
            <input type="text" placeholder="Phonetic" className="w-1/2 p-2 text-sm border rounded bg-white dark:bg-gray-900 dark:border-gray-700 text-gray-900 dark:text-gray-100" value={newPronun.value} onChange={(e) => setNewPronun({ ...newPronun, value: e.target.value })} />
            <button onClick={handleAddPronun} className="px-3 bg-blue-600 hover:bg-blue-700 text-white rounded font-bold shadow-sm">+</button>
          </div>
          <ul className="space-y-2 mt-4 max-h-96 overflow-y-auto pr-2">
            {pronunciations.map((item, idx) => (
              <li key={`${item.key}-${idx}`} className="flex items-center gap-3 text-sm bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-800 dark:text-gray-200 p-2 rounded shadow-sm">
                <input type="checkbox" checked={selectedPronuns.includes(idx)} onChange={(e) => {
                  if (e.target.checked) setSelectedPronuns([...selectedPronuns, idx]);
                  else setSelectedPronuns(selectedPronuns.filter((i) => i !== idx));
                }} />
                <span className="flex-1"><strong>{item.key}</strong> &rarr; {item.value}</span>
              </li>
            ))}
          </ul>
          <button onClick={() => { setPronunciations(pronunciations.filter((_, i) => !selectedPronuns.includes(i))); setSelectedPronuns([]); }} className="text-xs text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 font-bold">Delete Selected</button>
        </div>

        <div className="space-y-4 p-4 border rounded dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
          <div className="flex flex-col gap-3 mb-2">
            <div>
              <h3 className="font-semibold text-lg">Biblical Books</h3>
              <p className="text-xs text-gray-500">Structural expansion.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button onClick={() => downloadCSV(books, 'biblical_books.csv')} className="text-xs bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 px-2 py-1 rounded cursor-pointer hover:bg-blue-200">Export</button>
              <button onClick={() => setBooks(BASE_BOOKS.map(({ key, value }) => ({ key, value })))} className="text-xs bg-yellow-100 dark:bg-yellow-900 text-yellow-800 dark:text-yellow-200 px-2 py-1 rounded cursor-pointer hover:bg-yellow-200">Reset</button>
              <label className="text-xs bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 px-2 py-1 rounded cursor-pointer hover:bg-gray-300 dark:hover:bg-gray-600">
                Import CSV
                <input type="file" accept=".csv" className="hidden" onChange={(e) => handleCSVUpload(e, books, setBooks)} />
              </label>
            </div>
          </div>
          <div className="flex gap-2">
            <input type="text" placeholder="Short (e.g. Gen)" className="w-1/2 p-2 text-sm border rounded bg-white dark:bg-gray-900 dark:border-gray-700 text-gray-900 dark:text-gray-100" value={newBook.key} onChange={(e) => setNewBook({ ...newBook, key: e.target.value })} />
            <input type="text" placeholder="Full" className="w-1/2 p-2 text-sm border rounded bg-white dark:bg-gray-900 dark:border-gray-700 text-gray-900 dark:text-gray-100" value={newBook.value} onChange={(e) => setNewBook({ ...newBook, value: e.target.value })} />
            <button onClick={handleAddBook} className="px-3 bg-green-600 hover:bg-green-700 text-white rounded font-bold shadow-sm">+</button>
          </div>
          <ul className="space-y-2 mt-4 max-h-96 overflow-y-auto pr-2">
            {books.map((item, idx) => (
              <li key={`${item.key}-${idx}`} className="flex items-center gap-3 text-sm bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-800 dark:text-gray-200 p-2 rounded shadow-sm">
                <input type="checkbox" checked={selectedBooks.includes(idx)} onChange={(e) => {
                  if (e.target.checked) setSelectedBooks([...selectedBooks, idx]);
                  else setSelectedBooks(selectedBooks.filter((i) => i !== idx));
                }} />
                <span className="flex-1"><strong>{item.key}</strong> &rarr; {item.value}</span>
              </li>
            ))}
          </ul>
          <button onClick={() => { setBooks(books.filter((_, i) => !selectedBooks.includes(i))); setSelectedBooks([]); }} className="text-xs text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 font-bold">Delete Selected</button>
        </div>
      </div>

      <div className="pt-4 border-t dark:border-gray-800 flex justify-end gap-3">
        <button onClick={loadProfiles} className="bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-900 dark:text-gray-100 font-bold py-2 px-6 rounded shadow border border-gray-200 dark:border-gray-700">
          Reload
        </button>
        <button onClick={() => void handleSave()} className="bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-6 rounded shadow">
          Save Profile
        </button>
      </div>
    </div>
  );
}

export default SmartAudioSettings;
