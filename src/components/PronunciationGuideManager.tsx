/* eslint-disable no-restricted-syntax */
"use client";

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'react-hot-toast';
import {
  createPronunciationGuide,
  mergePronunciationEntries,
  parsePronunciationGuide,
  type PronunciationGuide,
  type PronunciationGuideEntry,
  type PronunciationImportStrategy,
} from '@/lib/shared/pronunciation-guide';

interface PronunciationItem {
  key: string;
  value: string;
}

interface PronunciationGuideManagerProps {
  guideName: string;
  items: PronunciationItem[];
  onChange: (items: PronunciationItem[]) => void;
}

function toGuideEntries(items: PronunciationItem[]): PronunciationGuideEntry[] {
  return items.map((item) => ({ word: item.key, phonetic: item.value }));
}

function toItems(entries: PronunciationGuideEntry[]): PronunciationItem[] {
  return entries.map((entry) => ({ key: entry.word, value: entry.phonetic }));
}

function previewKey(item: PronunciationItem): string {
  return `${item.key}\u0000${item.value}`;
}

export function PronunciationGuideManager({ guideName, items, onChange }: PronunciationGuideManagerProps) {
  const [selectedWords, setSelectedWords] = useState<string[]>([]);
  const [newEntry, setNewEntry] = useState({ key: '', value: '' });
  const [importGuide, setImportGuide] = useState<PronunciationGuide | null>(null);
  const [importStrategy, setImportStrategy] = useState<PronunciationImportStrategy>('add-new');
  const [selectedImportWords, setSelectedImportWords] = useState<string[]>([]);
  const [importSelectedOnly, setImportSelectedOnly] = useState(false);
  const [previewUrls, setPreviewUrls] = useState<Record<string, string>>({});
  const previewUrlsRef = useRef<Record<string, string>>({});
  const previewPromisesRef = useRef<Record<string, Promise<string>>>({});
  const [generatingPreviews, setGeneratingPreviews] = useState<string[]>([]);
  const [playingPreview, setPlayingPreview] = useState<string | null>(null);

  useEffect(() => {
    previewUrlsRef.current = previewUrls;
  }, [previewUrls]);

  useEffect(() => () => {
    for (const url of Object.values(previewUrlsRef.current)) URL.revokeObjectURL(url);
  }, []);

  const selectedSet = useMemo(() => new Set(selectedWords), [selectedWords]);
  const generatingSet = useMemo(() => new Set(generatingPreviews), [generatingPreviews]);

  const handleExport = () => {
    const guide = createPronunciationGuide(guideName, toGuideEntries(items));
    const blob = new Blob([`${JSON.stringify(guide, null, 2)}\n`], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const safeName = (guideName || 'pronunciation-guide').trim().replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();
    link.href = url;
    link.download = `${safeName || 'pronunciation-guide'}.openreader-pronunciations.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleImportFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = parsePronunciationGuide(String(reader.result || ''), file.name);
        setImportGuide(parsed);
        setSelectedImportWords(parsed.entries.map((entry) => entry.word));
        setImportStrategy('add-new');
        setImportSelectedOnly(false);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Failed to read pronunciation guide');
      }
    };
    reader.onerror = () => toast.error('Failed to read pronunciation guide');
    reader.readAsText(file);
  };

  const applyImport = () => {
    if (!importGuide) return;
    const selected = new Set(selectedImportWords);
    const incoming = importSelectedOnly
      ? importGuide.entries.filter((entry) => selected.has(entry.word))
      : importGuide.entries;
    if (incoming.length === 0) {
      toast.error('Select at least one pronunciation to import.');
      return;
    }
    const merged = mergePronunciationEntries(toGuideEntries(items), incoming, importStrategy);
    onChange(toItems(merged));
    setSelectedWords([]);
    setImportGuide(null);
    toast.success(`Imported ${incoming.length} pronunciation${incoming.length === 1 ? '' : 's'}. Save the profile to keep these changes.`);
  };

  const generatePreview = async (item: PronunciationItem): Promise<string> => {
    const key = previewKey(item);
    const existing = previewUrlsRef.current[key];
    if (existing) return existing;
    const inFlight = previewPromisesRef.current[key];
    if (inFlight) return inFlight;

    setGeneratingPreviews((current) => current.includes(key) ? current : [...current, key]);
    const promise = (async () => {
      const text = item.value.startsWith('/') ? `[${item.key}](${item.value})` : `[${item.key}](/${item.value}/)`;
      const response = await fetch('/api/tts/preview', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-tts-provider': 'kokoro',
        },
        body: JSON.stringify({ text, voice: 'af_heart' }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || `Kokoro preview failed for ${item.key}`);
      }
      const url = URL.createObjectURL(await response.blob());
      previewUrlsRef.current = { ...previewUrlsRef.current, [key]: url };
      setPreviewUrls(previewUrlsRef.current);
      return url;
    })();
    previewPromisesRef.current[key] = promise;
    try {
      return await promise;
    } finally {
      delete previewPromisesRef.current[key];
      setGeneratingPreviews((current) => current.filter((preview) => preview !== key));
    }
  };

  const handleListen = async (item: PronunciationItem) => {
    const key = previewKey(item);
    try {
      setPlayingPreview(key);
      const audio = new Audio(await generatePreview(item));
      audio.onended = () => setPlayingPreview(null);
      audio.onerror = () => setPlayingPreview(null);
      await audio.play();
    } catch (error) {
      setPlayingPreview(null);
      toast.error(error instanceof Error ? error.message : 'Failed to play Kokoro preview');
    }
  };

  const generateMany = async (targetItems: PronunciationItem[]) => {
    if (targetItems.length === 0) {
      toast.error('Check at least one pronunciation first.');
      return;
    }
    let generated = 0;
    for (const item of targetItems) {
      try {
        await generatePreview(item);
        generated += 1;
      } catch (error) {
        toast.error(error instanceof Error ? error.message : `Failed to generate ${item.key}`);
      }
    }
    toast.success(`Kokoro generated ${generated} of ${targetItems.length} preview${targetItems.length === 1 ? '' : 's'}.`);
  };

  const addEntry = () => {
    const key = newEntry.key.trim();
    const value = newEntry.value.trim();
    if (!key || !value) return;
    onChange(toItems(mergePronunciationEntries(toGuideEntries(items), [{ word: key, phonetic: value }], 'overwrite-matches')));
    setNewEntry({ key: '', value: '' });
  };

  return (
    <>
      <div className="space-y-4 p-4 border rounded dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
        <div className="flex flex-col gap-3">
          <div>
            <h3 className="font-semibold text-lg">Pronunciation Guide</h3>
            <p className="text-xs text-gray-500">
              Portable guides contain only words and phonetics. Kokoro audio is generated on demand and is not included in exports.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={handleExport} disabled={items.length === 0} className="text-xs bg-accent text-background px-2 py-1 rounded disabled:opacity-50">
              Export universal guide
            </button>
            <label className="text-xs bg-surface-sunken text-foreground px-2 py-1 rounded cursor-pointer hover:bg-accent-wash border border-line">
              Import guide
              <input type="file" accept=".json,.csv,.openreader-pronunciations.json,application/json,text/csv" className="hidden" onChange={handleImportFile} />
            </label>
            <button type="button" onClick={() => void generateMany(items.filter((item) => selectedSet.has(item.key)))} className="text-xs bg-surface-sunken text-foreground px-2 py-1 rounded border border-line hover:bg-accent-wash">
              Generate checked
            </button>
            <button type="button" onClick={() => void generateMany(items)} disabled={items.length === 0} className="text-xs bg-surface-sunken text-foreground px-2 py-1 rounded border border-line hover:bg-accent-wash disabled:opacity-50">
              Generate all
            </button>
          </div>
          <p className="text-xs text-soft">
            Default behavior: Kokoro generates a preview only when you click Listen. Use Generate checked or Generate all to prepare previews in advance.
          </p>
        </div>

        <div className="flex gap-2">
          <input type="text" placeholder="Word" className="w-1/2 p-2 text-sm border rounded bg-white dark:bg-gray-900 dark:border-gray-700 text-gray-900 dark:text-gray-100" value={newEntry.key} onChange={(event) => setNewEntry({ ...newEntry, key: event.target.value })} />
          <input type="text" placeholder="Phonetic" className="w-1/2 p-2 text-sm border rounded bg-white dark:bg-gray-900 dark:border-gray-700 text-gray-900 dark:text-gray-100" value={newEntry.value} onChange={(event) => setNewEntry({ ...newEntry, value: event.target.value })} />
          <button type="button" onClick={addEntry} className="px-3 bg-accent text-background rounded font-bold shadow-sm">+</button>
        </div>

        <ul className="space-y-2 mt-4 max-h-96 overflow-y-auto pr-2">
          {items.map((item) => {
            const itemPreviewKey = previewKey(item);
            return (
              <li key={item.key} className="flex items-center gap-3 text-sm bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-800 dark:text-gray-200 p-2 rounded shadow-sm">
                <input
                  type="checkbox"
                  checked={selectedSet.has(item.key)}
                  onChange={(event) => setSelectedWords((current) => event.target.checked ? [...current, item.key] : current.filter((word) => word !== item.key))}
                />
                <span className="flex-1"><strong>{item.key}</strong> &rarr; <code>{item.value}</code></span>
                {previewUrls[itemPreviewKey] && <span className="text-[10px] text-accent">Ready</span>}
                <button
                  type="button"
                  onClick={() => void handleListen(item)}
                  disabled={generatingSet.has(itemPreviewKey) || playingPreview === itemPreviewKey}
                  className="px-2 py-1 bg-accent-wash text-accent rounded text-xs font-semibold disabled:opacity-50"
                >
                  {generatingSet.has(itemPreviewKey) ? 'Generating…' : playingPreview === itemPreviewKey ? 'Playing…' : 'Listen'}
                </button>
              </li>
            );
          })}
        </ul>
        {items.length === 0 && <p className="text-sm text-soft">No pronunciations in this profile yet.</p>}
        <button
          type="button"
          onClick={() => {
            onChange(items.filter((item) => !selectedSet.has(item.key)));
            setSelectedWords([]);
          }}
          disabled={selectedWords.length === 0}
          className="text-xs text-danger font-bold disabled:opacity-50"
        >
          Delete checked
        </button>
      </div>

      {importGuide && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div role="dialog" aria-modal="true" aria-labelledby="pronunciation-import-title" className="bg-surface text-foreground rounded-lg shadow-xl w-full max-w-3xl flex flex-col max-h-[90vh] border border-line">
            <div className="p-4 border-b border-line flex justify-between items-start gap-3">
              <div>
                <h3 id="pronunciation-import-title" className="text-lg font-bold">Import pronunciation guide</h3>
                <p className="text-xs text-soft">{importGuide.name} · {importGuide.entries.length} pronunciation{importGuide.entries.length === 1 ? '' : 's'}</p>
              </div>
              <button type="button" onClick={() => setImportGuide(null)} aria-label="Close pronunciation import">✕</button>
            </div>

            <div className="p-4 space-y-4 overflow-y-auto">
              <fieldset className="space-y-2">
                <legend className="text-sm font-semibold">How should this guide affect the current profile?</legend>
                {([
                  ['add-new', 'Keep existing pronunciations', 'Only add words that are not already in your guide.'],
                  ['overwrite-matches', 'Use imported versions for matches', 'Overwrite matching words and keep existing words not in the import.'],
                  ['replace-all', 'Use only the imported guide', 'Remove the current guide and replace it with the imported pronunciations.'],
                ] as const).map(([value, label, description]) => (
                  <label key={value} className="flex items-start gap-2 rounded border border-line p-3 cursor-pointer hover:bg-accent-wash">
                    <input type="radio" name="pronunciation-import-strategy" value={value} checked={importStrategy === value} onChange={() => setImportStrategy(value)} />
                    <span><strong className="block text-sm">{label}</strong><span className="text-xs text-soft">{description}</span></span>
                  </label>
                ))}
              </fieldset>

              <label className="flex items-center gap-2 text-sm font-semibold">
                <input type="checkbox" checked={importSelectedOnly} onChange={(event) => setImportSelectedOnly(event.target.checked)} />
                Import only checked pronunciations
              </label>

              <div className="flex gap-2">
                <button type="button" onClick={() => setSelectedImportWords(importGuide.entries.map((entry) => entry.word))} className="text-xs text-accent">Check all</button>
                <button type="button" onClick={() => setSelectedImportWords([])} className="text-xs text-soft">Check none</button>
              </div>

              <ul className="space-y-2">
                {importGuide.entries.map((entry) => (
                  <li key={entry.word} className="flex items-center gap-3 rounded border border-line p-2">
                    <input
                      type="checkbox"
                      checked={selectedImportWords.includes(entry.word)}
                      onChange={(event) => setSelectedImportWords((current) => event.target.checked ? [...current, entry.word] : current.filter((word) => word !== entry.word))}
                    />
                    <span className="flex-1 text-sm"><strong>{entry.word}</strong> &rarr; <code>{entry.phonetic}</code></span>
                    <button type="button" onClick={() => void handleListen({ key: entry.word, value: entry.phonetic })} className="px-2 py-1 bg-accent-wash text-accent rounded text-xs">
                      Listen
                    </button>
                  </li>
                ))}
              </ul>
              <p className="text-xs text-soft">Imported changes remain unsaved until you click Save Profile.</p>
            </div>

            <div className="p-4 border-t border-line flex justify-end gap-2">
              <button type="button" onClick={() => setImportGuide(null)} className="px-4 py-2 border border-line rounded">Cancel</button>
              <button type="button" onClick={applyImport} className="px-4 py-2 bg-accent text-background rounded font-semibold">Import guide</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
