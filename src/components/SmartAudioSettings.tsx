/* eslint-disable no-restricted-syntax */
"use client";

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { BASE_ABBREVIATIONS, BASE_BOOKS, PRESET_MODELS, PRESET_PROMPTS } from './constants';
import type { SmartAudioProfile } from '@/types/client';
import { toast } from 'react-hot-toast';
import { ScanForeignWordsModal } from './doclist/ScanForeignWordsModal';
import { BookPronunciationInspectorModal } from './doclist/BookPronunciationInspectorModal';
import { SmartAudioWizardModal } from './SmartAudioWizardModal';
import { PronunciationGuideManager } from './PronunciationGuideManager';
import { DEFAULT_KOKORO_PRONUNCIATION_GUIDANCE } from '@/lib/shared/kokoro-pronunciation-policy';

const EMPTY_PROFILE = (): SmartAudioProfile => ({
  id: `profile-${Date.now()}`,
  name: 'New Profile',
  aiModel: PRESET_MODELS[0]?.id || 'gemini-3.6-flash',
  customTtsPrompt: '',
  abbreviations: {},
  pronunciations: {},
  books: {},
  pronunciationPromptMode: 'default',
  customPronunciationPrompt: '',
  workerMode: 'standard',
});

const WORKER_MODES = [
  {
    id: 'standard' as const,
    icon: '⚡',
    label: 'Standard AI Cleaner',
    badge: 'General purpose',
    description: 'Cleans formatting, fixes OCR errors, expands Bible citations (e.g. "Jn 3:16" → "John chapter 3 verse 16"), and applies your custom abbreviation and pronunciation lists. Best for general audiobooks, novels, and non-fiction.',
    features: ['OCR & hyphenation repair', 'Bible citation expansion', 'Custom abbreviations & pronunciations', 'TTS cadence optimization', 'Kokoro IPA markup for Greek & Hebrew'],
    presetName: 'Standard Audiobook Cleaner',
  },
  {
    id: 'scholar' as const,
    icon: '📖',
    label: 'Biblical Scholar & Theology',
    badge: 'Academic & ancient languages',
    description: 'Uses a specialized multi-pass pipeline. First, a dedicated AI pass identifies isolated Koine Greek and Biblical Hebrew words and inserts inline English definitions/glosses for listening clarity. Then the main cleaning pass applies strict Erasmian Greek and Academic Hebrew Kokoro IPA phonetic markup, prunes long foreign-language quotations, strips dense footnotes, and generates a full line-by-line changelog. Best for commentaries, study Bibles, and academic papers.',
    features: ['Everything in Standard', 'Greek & Hebrew lexical definition injection', 'Strict Erasmian + Academic Hebrew IPA markup', 'Inline English gloss preservation', 'Full changelog / diff generation', 'Phonetic auto-learning (saves new IPA to your profile)'],
    presetName: 'Biblical Scholar & Theology',
  },
];

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
  const [backupApiKey, setBackupApiKey] = useState('');
  const [maskedBackupKey, setMaskedBackupKey] = useState<string | null>(null);
  const [profiles, setProfiles] = useState<SmartAudioProfile[]>([]);
  const [workerMode, setWorkerMode] = useState<'standard' | 'scholar'>('scholar');
  const [useGlobalPronunciations, setUseGlobalPronunciations] = useState<boolean>(true);
  const [pronunciationPromptMode, setPronunciationPromptMode] = useState<'default' | 'custom'>('default');
  const [customPronunciationPrompt, setCustomPronunciationPrompt] = useState('');
  const [selectedProfileId, setSelectedProfileId] = useState<string>('');
  const [profileName, setProfileName] = useState('');
  const [aiModel, setAiModel] = useState(PRESET_MODELS[0]?.id || 'gemini-3.6-flash');
  const [customModelId, setCustomModelId] = useState('');
  const [promptMode, setPromptMode] = useState<'preset' | 'custom'>('preset');
  const [selectedPromptName, setSelectedPromptName] = useState<string>(PRESET_PROMPTS[0]?.name || '');
  const [prompt, setPrompt] = useState('');
  const [abbreviations, setAbbreviations] = useState(BASE_ABBREVIATIONS.map(({ key, value }) => ({ key, value })));
  const [pronunciations, setPronunciations] = useState<Array<{ key: string; value: string }>>([]);
  const [books, setBooks] = useState(BASE_BOOKS.map(({ key, value }) => ({ key, value })));
  const [selectedAbbrevs, setSelectedAbbrevs] = useState<number[]>([]);
  const [selectedBooks, setSelectedBooks] = useState<number[]>([]);
  const [newAbbrev, setNewAbbrev] = useState({ key: '', value: '' });
  const [newBook, setNewBook] = useState({ key: '', value: '' });
  const [isLoading, setIsLoading] = useState(true);

  const [isGlobalModalOpen, setIsGlobalModalOpen] = useState(false);
  const [globalPronunciations, setGlobalPronunciations] = useState<{key: string; values: string[]}[]>([]);
  const [isLoadingGlobal, setIsLoadingGlobal] = useState(false);
  const [playingKey, setPlayingKey] = useState<string | null>(null);

  const [isScannerOpen, setIsScannerOpen] = useState(false);
  const [isInspectorOpen, setIsInspectorOpen] = useState(false);
  const [isWizardOpen, setIsWizardOpen] = useState(false);

  const handleSaveUniversalSetup = async (config: {
    universalApiKey: string;
    backupApiKey: string;
    selectedModel: string;
    chosenWorkerMode: 'standard' | 'scholar';
    useGlobal: boolean;
    importGlobal: boolean;
  }) => {
    try {
      // 1. Update API key in settings if provided
      if (config.universalApiKey) {
        await fetch('/api/admin/settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key: 'geminiApiKey', value: config.universalApiKey })
        });
      }
      if (config.backupApiKey) {
        await fetch('/api/admin/settings', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ key: 'backupGeminiApiKey', value: config.backupApiKey })
        });
      }

      // 2. Cascade API Key and Model to ALL profiles
      const updatedProfiles = profiles.map(p => ({
        ...p,
        geminiApiKey: config.universalApiKey || p.geminiApiKey,
        aiModel: config.selectedModel,
        workerMode: config.chosenWorkerMode
      }));

      // If user chose importGlobal, fetch global pronunciations and merge
      if (config.importGlobal) {
        const res = await fetch('/api/tts/global-pronunciations');
        if (res.ok) {
          const globalData = await res.json();
          const resolvedGlobal: Record<string, string> = {};
          for (const [key, val] of Object.entries(globalData)) {
            if (Array.isArray(val) && val.length > 0) resolvedGlobal[key] = val[0] as string;
            else if (typeof val === 'string') resolvedGlobal[key] = val;
          }
          if (updatedProfiles[0]) {
            updatedProfiles[0].pronunciations = { ...resolvedGlobal, ...updatedProfiles[0].pronunciations };
          }
        }
      }

      setProfiles(updatedProfiles);
      setUseGlobalPronunciations(config.useGlobal);

      // Save profiles back to server
      await fetch('/api/tts-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          selectedSmartAudioProfileId: selectedProfileId || updatedProfiles[0]?.id || '',
          smartAudioProfiles: updatedProfiles
        })
      });

      toast.success('Universal Setup applied across all profiles!');
      void loadProfiles();
    } catch (e) {
      console.error('Failed to save universal setup', e);
      toast.error('Failed to save setup');
    }
  };

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

  const loadGlobalPronunciations = async () => {
    setIsLoadingGlobal(true);
    setIsGlobalModalOpen(true);
    try {
      const res = await fetch('/api/tts/global-pronunciations');
      const data = await res.json();
      setGlobalPronunciations(Object.entries(data).map(([key, value]) => {
        const rawArr = Array.isArray(value) ? value : [value];
        const stringValues = rawArr.map((item: unknown) => {
          if (typeof item !== 'object' || item === null) return String(item);
          if ('phonetic' in item && typeof item.phonetic === 'string') return item.phonetic;
          return JSON.stringify(item);
        });
        return { key, values: stringValues };
      }));
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoadingGlobal(false);
    }
  };

  const handleAdoptGlobal = async (word: string, phonetic: string) => {
    setPronunciations((prev) => {
      const filtered = prev.filter(p => p.key !== word);
      return [{ key: word, value: phonetic }, ...filtered];
    });

    try {
      await fetch('/api/tts/global-pronunciations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ word, phonetic })
      });
      loadGlobalPronunciations();
    } catch(e) {
      console.error(e);
    }
  };

  const playPreview = async (word: string, phonetic: string) => {
    try {
      setPlayingKey(word);
      const textToSynthesize = phonetic.startsWith('/') ? `[${word}](${phonetic})` : phonetic;
      const res = await fetch('/api/tts/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: textToSynthesize })
      });
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        throw new Error(errorData.error || 'Preview failed');
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.onended = () => {
        URL.revokeObjectURL(url);
        setPlayingKey(null);
      };
      await audio.play();
    } catch (err) {
      console.error(err);
      setPlayingKey(null);
    }
  };

  useEffect(() => {
    if (!activeProfile) return;
    setProfileName(activeProfile.name);
    setWorkerMode(activeProfile.workerMode ?? 'scholar');
    setUseGlobalPronunciations(activeProfile.useGlobalPronunciations ?? true);
    setPronunciationPromptMode(activeProfile.pronunciationPromptMode === 'custom' ? 'custom' : 'default');
    setCustomPronunciationPrompt(activeProfile.customPronunciationPrompt || '');
    setAiModel(activeProfile.aiModel || PRESET_MODELS[0]?.id || 'gemini-2.5-flash');
    setCustomModelId(activeProfile.aiModel && PRESET_MODELS.some((model) => model.id === activeProfile.aiModel) ? '' : activeProfile.aiModel);

    const savedPrompt = activeProfile.customTtsPrompt || '';

    // --- Legacy migration ---
    // Old profiles stored a prompt that began with a "NOTE:" UI annotation.
    // Detect that pattern and silently upgrade to the clean new preset so the
    // stale NOTE never gets sent to Gemini again.
    const isLegacyScholarPrompt =
      savedPrompt.trimStart().startsWith('NOTE:') ||
      savedPrompt.includes('automatically inject English definitions');

    const matchedPreset = isLegacyScholarPrompt
      ? PRESET_PROMPTS.find((p) => p.workerMode === 'scholar')
      : PRESET_PROMPTS.find((preset) => preset.content.trim() === savedPrompt.trim());

    if (matchedPreset) {
      setPromptMode('preset');
      setSelectedPromptName(matchedPreset.name);
      setPrompt(matchedPreset.content);
      // If we just auto-migrated, also set the worker mode card correctly.
      if (isLegacyScholarPrompt) {
        setWorkerMode('scholar');
      }
    } else {
      setPromptMode('custom');
      setSelectedPromptName('');
      setPrompt(savedPrompt);
    }
    setAbbreviations(objectToEntries(activeProfile.abbreviations || {}));
    setPronunciations(objectToEntries(activeProfile.pronunciations || {}));
    setBooks(objectToEntries(activeProfile.books || {}));
    // Load this profile's key — show masked placeholder if already saved
    setApiKey('');
    setMaskedKey(activeProfile.geminiApiKey ? `••••••••••••${activeProfile.geminiApiKey.slice(-4)}` : null);
    setBackupApiKey('');
    setMaskedBackupKey(activeProfile.backupGeminiApiKey ? `••••••••••••${activeProfile.backupGeminiApiKey.slice(-4)}` : null);
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
      useGlobalPronunciations,
      pronunciationPromptMode,
      customPronunciationPrompt: pronunciationPromptMode === 'custom' ? customPronunciationPrompt.trim() : '',
      workerMode,
      // Preserve stored key; overwrite only if user typed a new one
      geminiApiKey: apiKey.trim() || activeProfile?.geminiApiKey || undefined,
      backupGeminiApiKey: backupApiKey.trim() || activeProfile?.backupGeminiApiKey || undefined,
    };
  }, [apiKey, backupApiKey, aiModel, customModelId, profileName, selectedProfileId, prompt, abbreviations, pronunciations, books, useGlobalPronunciations, pronunciationPromptMode, customPronunciationPrompt, workerMode, activeProfile]);

  // When the user clicks a worker mode card, always switch to the matching
  // preset for that engine. This ensures clicking a card is always a clean
  // one-click reset to the correct prompt template.
  const handleWorkerModeChange = useCallback((mode: 'standard' | 'scholar') => {
    setWorkerMode(mode);
    const targetMode = WORKER_MODES.find((m) => m.id === mode);
    const matchingPreset = PRESET_PROMPTS.find((p) => p.name === targetMode?.presetName);
    if (matchingPreset) {
      setPromptMode('preset');
      setSelectedPromptName(matchingPreset.name);
      setPrompt(matchingPreset.content);
    }
  }, []);

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
    setPronunciationPromptMode('default');
    setCustomPronunciationPrompt('');
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
      if (backupApiKey) {
        setMaskedBackupKey(`••••••••••••${backupApiKey.slice(-4)}`);
        setBackupApiKey('');
      }
      alert('Smart audio profile saved.');
      window.dispatchEvent(new CustomEvent('smart-audio-profiles-updated'));
    } catch (error) {
      console.error('Error saving smart audio settings:', error);
      alert('Failed to save smart audio settings. Check the server logs.');
    }
  }, [apiKey, backupApiKey, buildCurrentProfile, profiles]);

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

      {/* Top Banner & Guided Setup Launcher */}
      <div className="p-4 bg-gradient-to-r from-purple-950 via-indigo-900 to-slate-900 text-white rounded-2xl shadow-xl flex flex-col md:flex-row items-center justify-between gap-4 border border-purple-800/50">
        <div className="flex items-center gap-3">
          <span className="text-4xl">🪄</span>
          <div>
            <h2 className="text-lg font-bold">Smart Audio Profile Wizard & Universal Key Setup</h2>
            <p className="text-xs text-purple-200 mt-0.5">
              Set up your Universal Gemini API key, choose your default model (Gemini 3.6 Flash), configure Biblical Scholar vs Standard settings, and explore the 12-point prompt walkthrough.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setIsWizardOpen(true)}
          className="px-5 py-2.5 bg-purple-500 hover:bg-purple-400 text-white font-bold text-xs rounded-xl shadow-lg transition-all shrink-0 flex items-center gap-2 border border-purple-300/30"
        >
          <span>✨</span> Launch Guided Setup Wizard
        </button>
      </div>
      <div className="space-y-3">
        <div>
          <h3 className="text-base font-semibold">AI Processing Engine</h3>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            Choose which background Python worker handles AI text cleaning for this profile.
            Switching engines will automatically update the prompt template if you are using a preset.
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {WORKER_MODES.map((mode) => {
            const isSelected = workerMode === mode.id;
            return (
              <button
                key={mode.id}
                type="button"
                onClick={() => handleWorkerModeChange(mode.id)}
                className={`text-left p-4 rounded-xl border-2 transition-all duration-150 ${
                  isSelected
                    ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/40 shadow-md'
                    : 'border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 hover:border-blue-300 dark:hover:border-blue-700 hover:shadow-sm'
                }`}
              >
                <div className="flex items-start gap-3">
                  <span className="text-2xl mt-0.5">{mode.icon}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`font-semibold text-sm ${
                        isSelected ? 'text-blue-700 dark:text-blue-300' : 'text-gray-900 dark:text-gray-100'
                      }`}>
                        {mode.label}
                      </span>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                        isSelected
                          ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/60 dark:text-blue-300'
                          : 'bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-300'
                      }`}>
                        {mode.badge}
                      </span>
                      {isSelected && (
                        <span className="ml-auto text-blue-500 dark:text-blue-400 text-base">✓</span>
                      )}
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1.5 leading-relaxed">
                      {mode.description}
                    </p>
                    <ul className="mt-2 space-y-0.5">
                      {mode.features.map((f) => (
                        <li key={f} className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1.5">
                          <span className={`text-xs ${
                            isSelected ? 'text-blue-400' : 'text-gray-400'
                          }`}>•</span>
                          {f}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div className={`p-4 rounded-xl border-2 transition-all duration-150 flex items-center justify-between gap-4 cursor-pointer ${
        useGlobalPronunciations
          ? 'border-purple-500 bg-purple-50 dark:bg-purple-900/20 shadow-md'
          : 'border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 hover:border-purple-300 dark:hover:border-purple-700 hover:shadow-sm'
      }`}
      onClick={() => setUseGlobalPronunciations(!useGlobalPronunciations)}>
        <div className="flex items-start gap-3">
          <span className="text-3xl mt-1">🌍</span>
          <div>
            <h3 className={`text-base font-semibold ${useGlobalPronunciations ? 'text-purple-800 dark:text-purple-300' : 'text-gray-900 dark:text-gray-100'}`}>
              Global Learned Dictionary
            </h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
              Automatically apply crowdsourced global pronunciations learned across all user audiobooks. Includes up to 5 alternative choices per word that you can review and adopt to your own profile!
            </p>
          </div>
        </div>
        <div className="shrink-0 flex flex-col sm:flex-row items-center gap-2">
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setIsScannerOpen(true); }}
            className="text-xs font-semibold px-3 py-1.5 bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 rounded hover:bg-blue-200 dark:hover:bg-blue-800 transition-colors sm:mr-2"
          >
            Pre-Scan a Document 🔍
          </button>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setIsInspectorOpen(true); }}
            className="text-xs font-semibold px-3 py-1.5 bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 rounded hover:bg-blue-200 dark:hover:bg-blue-800 transition-colors sm:mr-2"
          >
            Inspect Book Pronunciations 📚
          </button>
          <button 
            type="button" 
            onClick={(e) => { e.stopPropagation(); loadGlobalPronunciations(); }} 
            className="text-xs font-semibold px-3 py-1.5 bg-purple-200 dark:bg-purple-800 text-purple-800 dark:text-purple-200 rounded hover:bg-purple-300 dark:hover:bg-purple-700 transition-colors sm:mr-2"
          >
            View Global List
          </button>
          <div className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${useGlobalPronunciations ? 'bg-purple-600' : 'bg-gray-300 dark:bg-gray-600'}`}>
            <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${useGlobalPronunciations ? 'translate-x-6' : 'translate-x-1'}`} />
          </div>
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
              <label className="block text-sm font-semibold">Primary Gemini API Key (e.g. Free Tier)</label>
              {maskedKey && (
                <span className="text-xs font-mono bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400 px-2 py-0.5 rounded">Active: {maskedKey}</span>
              )}
            </div>
            <input
              type="password"
              className="w-full p-2 border rounded bg-gray-50 dark:bg-gray-800 dark:border-gray-700 text-gray-900 dark:text-gray-100"
              placeholder={maskedKey ? 'Enter a new primary key to overwrite...' : 'Enter your API key...'}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <div className="flex justify-between items-end gap-2">
              <label className="block text-sm font-semibold">Backup Gemini API Key (e.g. Paid Tier)</label>
              {maskedBackupKey && (
                <span className="text-xs font-mono bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400 px-2 py-0.5 rounded">Active: {maskedBackupKey}</span>
              )}
            </div>
            <input
              type="password"
              className="w-full p-2 border rounded bg-gray-50 dark:bg-gray-800 dark:border-gray-700 text-gray-900 dark:text-gray-100"
              placeholder={maskedBackupKey ? 'Enter a new backup key to overwrite...' : 'Enter your backup API key...'}
              value={backupApiKey}
              onChange={(e) => setBackupApiKey(e.target.value)}
            />
            <p className="text-xs text-gray-400">
              {maskedKey || maskedBackupKey ? 'Leave blank to keep using the saved key for this profile.' : 'Required. Keys are saved securely to this profile. The backup key is automatically used if the primary key hits a rate limit.'}
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

        <div className="space-y-3">
          <div className="space-y-2 rounded border border-line bg-surface p-3">
            <div>
              <h3 className="text-sm font-semibold">Gemini pronunciation guidance</h3>
              <p className="text-xs text-soft">
                The required Kokoro compatibility rules always apply. Customize only this profile&apos;s pronunciation style.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setPronunciationPromptMode('default')}
                className={`px-3 py-1.5 rounded border text-xs font-medium ${pronunciationPromptMode === 'default' ? 'bg-accent text-background border-accent' : 'bg-surface text-foreground border-line hover:bg-accent-wash'}`}
              >
                Use universal default
              </button>
              <button
                type="button"
                onClick={() => {
                  setPronunciationPromptMode('custom');
                  setCustomPronunciationPrompt((current) => current || DEFAULT_KOKORO_PRONUNCIATION_GUIDANCE);
                }}
                className={`px-3 py-1.5 rounded border text-xs font-medium ${pronunciationPromptMode === 'custom' ? 'bg-accent text-background border-accent' : 'bg-surface text-foreground border-line hover:bg-accent-wash'}`}
              >
                Customize this profile
              </button>
            </div>
            <textarea
              value={pronunciationPromptMode === 'custom' ? customPronunciationPrompt : DEFAULT_KOKORO_PRONUNCIATION_GUIDANCE}
              onChange={(event) => setCustomPronunciationPrompt(event.target.value)}
              readOnly={pronunciationPromptMode === 'default'}
              className="w-full h-40 p-3 border rounded bg-surface-sunken border-line text-foreground font-mono text-xs leading-relaxed"
              aria-label="Profile pronunciation guidance"
            />
            <p className="text-xs text-soft">
              {pronunciationPromptMode === 'default'
                ? 'This profile automatically receives future universal-default improvements.'
                : 'This custom guidance applies only to the selected profile. Compatibility exclusions remain enforced separately.'}
            </p>
          </div>
          <label className="flex items-center gap-2 text-xs text-gray-700 dark:text-gray-300 font-medium cursor-pointer">
            <input
              type="checkbox"
              checked={useGlobalPronunciations}
              onChange={(e) => setUseGlobalPronunciations(e.target.checked)}
              className="rounded border-gray-300 dark:border-gray-700 text-purple-600 focus:ring-purple-500"
            />
            Include Global Learned Pronunciations
          </label>
          <button onClick={loadGlobalPronunciations} className="text-xs bg-purple-100 dark:bg-purple-900 text-purple-800 dark:text-purple-200 px-2 py-1 rounded cursor-pointer hover:bg-purple-200 self-start">
            View Global Pronunciations
          </button>
          <PronunciationGuideManager
            key={selectedProfileId}
            guideName={`${profileName || 'OpenReader'} Pronunciation Guide`}
            items={pronunciations}
            onChange={setPronunciations}
          />
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

      {isGlobalModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white dark:bg-gray-900 rounded-lg shadow-xl w-full max-w-2xl flex flex-col max-h-[90vh]">
            <div className="p-4 border-b dark:border-gray-800 flex justify-between items-center">
              <h3 className="text-lg font-bold">Global Pronunciations</h3>
              <button onClick={() => setIsGlobalModalOpen(false)} className="text-gray-500 hover:text-gray-800 dark:hover:text-gray-200">✕</button>
            </div>
            <div className="p-4 overflow-y-auto flex-1">
              {isLoadingGlobal ? (
                <div className="flex justify-center p-8"><span className="text-gray-500">Loading...</span></div>
              ) : globalPronunciations.length === 0 ? (
                <div className="text-center p-8 text-gray-500">No global pronunciations found.</div>
              ) : (
                <ul className="space-y-3">
                  {globalPronunciations.map((item) => (
                    <li key={item.key} className="flex flex-col gap-2 bg-gray-50 dark:bg-gray-800 p-3 rounded border border-gray-200 dark:border-gray-700">
                      <strong className="block text-sm">{item.key}</strong>
                      <div className="flex flex-col gap-2">
                        {item.values.map((phonetic, idx) => (
                          <div key={idx} className="flex items-center gap-3 bg-white dark:bg-gray-900 p-2 rounded border border-gray-200 dark:border-gray-700">
                            <code className="flex-1 text-xs text-purple-600 dark:text-purple-400">{phonetic}</code>
                            <button
                              onClick={() => playPreview(item.key, phonetic)}
                              disabled={playingKey === item.key}
                              className="px-2 py-1 bg-blue-100 dark:bg-blue-900/50 hover:bg-blue-200 dark:hover:bg-blue-900 text-blue-700 dark:text-blue-300 rounded text-xs font-semibold disabled:opacity-50"
                            >
                              {playingKey === item.key ? 'Playing...' : 'Listen'}
                            </button>
                            <button
                              onClick={() => handleAdoptGlobal(item.key, phonetic)}
                              className="px-2 py-1 bg-green-100 dark:bg-green-900/50 hover:bg-green-200 dark:hover:bg-green-900 text-green-700 dark:text-green-300 rounded text-xs font-semibold"
                            >
                              Adopt to My Profile
                            </button>
                          </div>
                        ))}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="p-4 border-t dark:border-gray-800 flex justify-end">
              <button onClick={() => setIsGlobalModalOpen(false)} className="px-4 py-2 bg-gray-200 dark:bg-gray-800 rounded font-semibold text-sm">Close</button>
            </div>
          </div>
        </div>
      )}
      {isWizardOpen && (
        <SmartAudioWizardModal
          isOpen={isWizardOpen}
          onClose={() => setIsWizardOpen(false)}
          currentApiKey={apiKey || maskedKey || ''}
          onSaveUniversalSetup={handleSaveUniversalSetup}
        />
      )}
    </div>
  );
}

export default SmartAudioSettings;
