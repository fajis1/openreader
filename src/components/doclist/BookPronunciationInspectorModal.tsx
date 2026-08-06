import React, { useState, useEffect } from 'react';
import { ModalFrame } from '@/components/ui';
import toast from 'react-hot-toast';
import { useTtsPreviewSettings } from '@/hooks/audio/useTtsPreviewSettings';

export function BookPronunciationInspectorModal({
  isOpen,
  onClose,
  initialBookId,
  initialSearchQuery,
  initialUseFuzzySearch
}: {
  isOpen: boolean;
  onClose: () => void;
  initialBookId?: string | null;
  initialSearchQuery?: string;
  initialUseFuzzySearch?: boolean;
}) {
  const previewSettings = useTtsPreviewSettings();
  const [selectedBookId, setSelectedBookId] = useState<string>(initialBookId || '');
  const [letterFilter, setLetterFilter] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>(initialSearchQuery || '');
  const [useFuzzySearch, setUseFuzzySearch] = useState<boolean>(initialUseFuzzySearch || false);
  
  const [audiobooks, setAudiobooks] = useState<any[]>([]);
  const [words, setWords] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [editingWord, setEditingWord] = useState<string | null>(null);
  const [editValue, setEditValue] = useState<string>('');

  const [refineInput, setRefineInput] = useState<{ [word: string]: string }>({});
  const [refineStatus, setRefineStatus] = useState<{ [word: string]: string }>({});
  const [refineExpanded, setRefineExpanded] = useState<{ [word: string]: boolean }>({});
  const [batchReplaceStatus, setBatchReplaceStatus] = useState<{ [word: string]: string }>({});
  const [rebuildStatus, setRebuildStatus] = useState<string>('');
  const [pendingRebuildBooks, setPendingRebuildBooks] = useState<any[] | null>(null);
  const [selectedRebuildBooks, setSelectedRebuildBooks] = useState<Record<string, boolean>>({});

  const ALPHABET = ['ALL', 'A','B','C','D','E','F','G','H','I','J','K','L','M','N','O','P','Q','R','S','T','U','V','W','X','Y','Z', '#'];

  const fetchPronunciations = async (bookId: string, letter: string) => {
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams();
      if (bookId) qs.set('bookId', bookId);
      qs.set('letter', letter);
      const res = await fetch(`/api/audiobooks/pronunciations?${qs.toString()}`);
      if (!res.ok) throw new Error('Failed to load pronunciations');
      const data = await res.json();
      setWords(data.words || []);
      if (data.audiobooks) {
        setAudiobooks(data.audiobooks);
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      if (initialSearchQuery) setSearchQuery(initialSearchQuery);
      if (initialUseFuzzySearch !== undefined) setUseFuzzySearch(initialUseFuzzySearch);
      fetchPronunciations(selectedBookId, letterFilter);
    }
  }, [isOpen, selectedBookId, letterFilter, initialSearchQuery, initialUseFuzzySearch]);

  const handleListen = async (word: string, phonetic: string) => {
    try {
      const res = await fetch('/api/tts/preview', {
        method: 'POST',
        headers: previewSettings.headers,
        body: JSON.stringify({ text: `[${word}](/${phonetic}/)`, voice: previewSettings.voice })
      });
      if (!res.ok) return;
      const audioBlob = await res.blob();
      const url = URL.createObjectURL(audioBlob);
      const audio = new Audio(url);
      audio.play();
    } catch (e) {
      console.error('Playback error', e);
    }
  };

  const handleSaveOverride = async (word: string, phonetic: string) => {
    try {
      // First update the profile
      const settingsRes = await fetch('/api/tts-settings');
      const settings = await settingsRes.json();
      const profiles = settings.smartAudioProfiles || [];
      const selectedId = settings.selectedSmartAudioProfileId;
      const profile = profiles.find((p: any) => p.id === selectedId) || profiles[0];
      
      if (!profile) return;
      if (!profile.pronunciations) profile.pronunciations = {};
      profile.pronunciations[word] = phonetic;
      
      await fetch('/api/tts-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          smartAudioProfiles: profiles,
          selectedSmartAudioProfileId: selectedId
        })
      });

      // Then update global dictionary
      await fetch('/api/tts/global-pronunciations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ word, phonetic })
      });

      setEditingWord(null);
      // Refresh
      fetchPronunciations(selectedBookId, letterFilter);
    } catch (e) {
      console.error('Save error', e);
    }
  };

  const handleRefine = async (word: string) => {
    const prompt = refineInput[word] || "Generate 5 clean, standard Kokoro IPA pronunciations for this word";
    setRefineStatus(prev => ({ ...prev, [word]: 'Asking Gemini 3.6 Flash for 5 new options...' }));
    try {
      const res = await fetch('/api/tts/refine-pronunciations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ word, feedback: prompt, currentChoices: [] })
      });
      if (res.ok) {
        setRefineStatus(prev => ({ ...prev, [word]: 'Done! Pre-cached audio ready.' }));
        fetchPronunciations(selectedBookId, letterFilter);
      } else {
        const errData = await res.json().catch(() => ({}));
        const errMsg = errData.error || 'Refinement failed';
        toast.error(errMsg, { duration: 6000 });

        let secondsLeft = errMsg.includes('503') || errMsg.toLowerCase().includes('overloaded') ? 10 : 50;
        setRefineStatus(prev => ({ ...prev, [word]: `⚠️ ${errMsg} (Retrying reset in ${secondsLeft}s...)` }));

        const timer = setInterval(() => {
          secondsLeft -= 1;
          if (secondsLeft <= 0) {
            clearInterval(timer);
            setRefineStatus(prev => ({ ...prev, [word]: '' }));
          } else {
            setRefineStatus(prev => ({ ...prev, [word]: `⚠️ ${errMsg} (Ready in ${secondsLeft}s...)` }));
          }
        }, 1000);
      }
    } catch (e: any) {
      console.error(e);
      const errMsg = e.message || 'Failed.';
      toast.error(errMsg, { duration: 6000 });
      setRefineStatus(prev => ({ ...prev, [word]: `⚠️ ${errMsg}` }));
    }
  };

  const handleBatchReplace = async (word: string, newPhonetic: string) => {
    if (!confirm(`Are you sure you want to replace all occurrences of [${word}] with phonetics /${newPhonetic}/ in ALL your generated audiobook text chapters?`)) return;
    
    setBatchReplaceStatus(prev => ({ ...prev, [word]: 'Replacing...' }));
    try {
      const res = await fetch('/api/audiobooks/batch-replace', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ word, newPhonetic })
      });
      if (res.ok) {
        const data = await res.json();
        setBatchReplaceStatus(prev => ({ ...prev, [word]: `Updated ${data.updatedCount} files.` }));
        toast.success(`Updated ${data.updatedCount} text files.`);
      } else {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || 'Failed to replace');
      }
    } catch (e: any) {
       console.error(e);
       toast.error(e.message || 'Error executing batch replace');
       setBatchReplaceStatus(prev => ({ ...prev, [word]: 'Failed' }));
    }
  };

  const handleRebuildModified = async () => {
    setRebuildStatus('Scanning...');
    try {
      const res = await fetch('/api/audiobooks/batch-regenerate', { 
        method: 'POST', 
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookId: selectedBookId || undefined, dryRun: true }) 
      });
      if (res.ok) {
        const data = await res.json();
        if (data.needsRegeneration && data.needsRegeneration.length > 0) {
           setPendingRebuildBooks(data.needsRegeneration);
           const initialSelected: Record<string, boolean> = {};
           data.needsRegeneration.forEach((b: any) => { initialSelected[b.bookId] = true; });
           setSelectedRebuildBooks(initialSelected);
           setRebuildStatus('');
        } else {
           toast.success('No modified chunks found! Everything is up to date.');
           setRebuildStatus('');
        }
      } else {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to scan');
      }
    } catch (e: any) {
      toast.error(e.message || 'Error scanning books');
      setRebuildStatus('');
    }
  };

  const confirmRebuild = async () => {
    const bookIds = Object.keys(selectedRebuildBooks).filter(id => selectedRebuildBooks[id]);
    if (bookIds.length === 0) {
      setPendingRebuildBooks(null);
      return;
    }
    
    setRebuildStatus('Starting...');
    try {
      const res = await fetch('/api/audiobooks/batch-regenerate', { 
        method: 'POST', 
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookIds }) 
      });
      if (res.ok) {
        setRebuildStatus('Rebuilding in background...');
        toast.success('Background rebuild started for selected books!');
        setTimeout(() => setRebuildStatus(''), 8000);
        setPendingRebuildBooks(null);
      } else {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to start rebuild');
      }
    } catch (e: any) {
      toast.error(e.message || 'Error starting background rebuild');
      setRebuildStatus('');
      setPendingRebuildBooks(null);
    }
  };

  if (!isOpen) return null;

  const isSimilar = (a: string, b: string) => {
    if (!a || !b) return false;
    const aa = a.toLowerCase();
    const bb = b.toLowerCase();
    if (aa === bb) return true;
    if (aa.length > 3 && bb.includes(aa)) return true;
    if (bb.length > 3 && aa.includes(bb)) return true;
    if (aa.length < 4 || Math.abs(aa.length - bb.length) > 2) return false;
    
    const track = Array(bb.length + 1).fill(null).map(() => Array(aa.length + 1).fill(null));
    for (let i = 0; i <= aa.length; i += 1) track[0][i] = i;
    for (let j = 0; j <= bb.length; j += 1) track[j][0] = j;
    for (let j = 1; j <= bb.length; j += 1) {
      for (let i = 1; i <= aa.length; i += 1) {
        const indicator = aa[i - 1] === bb[j - 1] ? 0 : 1;
        track[j][i] = Math.min(
          track[j][i - 1] + 1,
          track[j - 1][i] + 1,
          track[j - 1][i - 1] + indicator
        );
      }
    }
    return track[bb.length][aa.length] <= 2;
  };

  const filteredWords = words.filter(w => {
    if (!searchQuery) return true;
    if (useFuzzySearch) return isSimilar(w.word, searchQuery);
    return w.word.toLowerCase().includes(searchQuery.toLowerCase());
  });

  const maxRender = 100;
  const renderedWords = filteredWords.slice(0, maxRender);

  return (
    <ModalFrame open={isOpen} onClose={onClose}>
      <div className="flex flex-col h-full max-h-[80vh] min-w-[600px] bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 p-4 relative">
        
        {pendingRebuildBooks && (
          <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-xl max-w-lg w-full border dark:border-gray-700">
              <h3 className="text-xl font-bold mb-4 text-gray-900 dark:text-white">Rebuild Modified Audio</h3>
              <p className="text-sm text-gray-600 dark:text-gray-300 mb-4">
                The following books have modified text chunks. Select which ones you want to regenerate TTS audio for:
              </p>
              <div className="max-h-60 overflow-y-auto mb-4 border rounded dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50">
                {pendingRebuildBooks.map(b => (
                  <label key={b.bookId} className="flex items-center gap-3 p-3 border-b dark:border-gray-700 hover:bg-gray-100 dark:hover:bg-gray-800 cursor-pointer">
                    <input 
                      type="checkbox" 
                      checked={!!selectedRebuildBooks[b.bookId]}
                      onChange={(e) => setSelectedRebuildBooks(prev => ({ ...prev, [b.bookId]: e.target.checked }))}
                      className="rounded text-emerald-600 focus:ring-emerald-500"
                    />
                    <div className="flex-1 text-sm font-medium text-gray-900 dark:text-white truncate">
                      {b.bookName}
                    </div>
                    <div className="text-xs text-orange-600 dark:text-orange-400 font-semibold bg-orange-50 dark:bg-orange-900/30 px-2 py-1 rounded">
                      {b.modifiedChunks} chunk{b.modifiedChunks !== 1 ? 's' : ''}
                    </div>
                  </label>
                ))}
              </div>
              <div className="flex justify-end gap-2 mt-4">
                <button 
                  className="px-4 py-2 border dark:border-gray-600 rounded text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700"
                  onClick={() => setPendingRebuildBooks(null)}
                >
                  Cancel
                </button>
                <button 
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded text-sm font-semibold disabled:opacity-50"
                  onClick={confirmRebuild}
                  disabled={!Object.values(selectedRebuildBooks).some(Boolean)}
                >
                  Rebuild Selected Books
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="flex gap-4 mb-4 items-center flex-wrap">
          <select
            className="p-2 border rounded bg-gray-50 dark:bg-gray-800 dark:border-gray-700"
            value={selectedBookId}
            onChange={e => setSelectedBookId(e.target.value)}
          >
            <option value="">All My Pronunciations</option>
            {audiobooks.map(b => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
          
          <input 
            type="text" 
            placeholder="Search words..." 
            className="p-2 border rounded bg-white dark:bg-gray-800 flex-1 dark:border-gray-700"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
          />
          <label className="flex items-center gap-2 cursor-pointer text-sm font-medium">
            <input 
              type="checkbox"
              checked={useFuzzySearch}
              onChange={e => setUseFuzzySearch(e.target.checked)}
              className="rounded text-blue-600 focus:ring-blue-500 bg-gray-50 border-gray-300"
            />
            Fuzzy Match (find similar)
          </label>
          <div className="flex-1 text-right">
            <button
              onClick={handleRebuildModified}
              disabled={!!rebuildStatus}
              className="px-3 py-1.5 bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200 border border-emerald-300 dark:border-emerald-700 rounded text-sm font-semibold hover:bg-emerald-200 dark:hover:bg-emerald-800 disabled:opacity-50"
              title="Automatically rebuild the TTS audio for any text chunk that was modified"
            >
              {rebuildStatus || 'Rebuild Modified Audio 🔄'}
            </button>
          </div>
        </div>

        <div className="flex flex-wrap gap-1 mb-4">
          {ALPHABET.map(l => (
            <button
              key={l}
              onClick={() => setLetterFilter(l)}
              className={`px-2 py-1 text-xs font-semibold border rounded ${letterFilter === l ? 'bg-blue-600 text-white border-blue-600' : 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700 hover:bg-gray-200 dark:hover:bg-gray-700'}`}
            >
              {l}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-auto border rounded dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
          {loading ? (
            <div className="p-4 text-center">Loading...</div>
          ) : error ? (
            <div className="p-4 text-center text-red-500">{error}</div>
          ) : filteredWords.length === 0 ? (
            <div className="p-4 text-center text-gray-500">No words found.</div>
          ) : (
            <>
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b dark:border-gray-700 bg-gray-100 dark:bg-gray-800 text-sm font-semibold">
                  <th className="p-3 w-1/3">Word</th>
                  <th className="p-3 w-1/3">Global Choices</th>
                  <th className="p-3 w-1/3">My Active Profile</th>
                </tr>
              </thead>
              <tbody>
                {renderedWords.map((w, idx) => (
                  <tr key={idx} className="border-b dark:border-gray-700">
                    <td className="p-3 align-top">
                      <div className="font-bold text-lg">{w.word}</div>
                      {w.count > 0 && <div className="text-xs text-gray-500">{w.count}x in book</div>}
                      <div className="mt-2 text-xs text-gray-600 dark:text-gray-400 font-mono">
                        Base: {w.phonetic || 'None'}
                      </div>
                      <button
                        className="mt-2 px-2 py-1 text-xs font-semibold bg-gray-200 dark:bg-gray-700 rounded hover:bg-gray-300 dark:hover:bg-gray-600"
                        onClick={() => handleListen(w.word, w.phonetic)}
                      >
                        Listen 🔊
                      </button>
                      <div className="mt-2">
                        <button
                          className="text-xs text-blue-600 dark:text-blue-400 font-medium hover:underline text-left flex items-center gap-1"
                          onClick={() => {
                            const isOpening = !refineExpanded[w.word];
                            setRefineExpanded(prev => ({ ...prev, [w.word]: isOpening }));
                            if (isOpening && (!w.globalChoices || w.globalChoices.length === 0)) {
                              void handleRefine(w.word);
                            }
                          }}
                        >
                          Refine with AI Prompt ▼
                        </button>
                        {refineExpanded[w.word] && (
                          <div className="mt-1 flex flex-col gap-1">
                            <textarea
                              className="w-full p-1 text-xs border rounded bg-white dark:bg-gray-800 dark:border-gray-700 text-gray-900 dark:text-gray-100"
                              placeholder="e.g. Make the ending sound like -een"
                              value={refineInput[w.word] || ''}
                              onChange={e => setRefineInput(prev => ({ ...prev, [w.word]: e.target.value }))}
                            />
                            <button
                              className="self-start px-2 py-1 text-[10px] font-semibold bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200 rounded disabled:opacity-50"
                              onClick={() => handleRefine(w.word)}
                              disabled={!!refineStatus[w.word]}
                            >
                              Generate 5 AI Options ✨
                            </button>
                            {refineStatus[w.word] && <div className="text-[10px] text-amber-600 dark:text-amber-400 animate-pulse">{refineStatus[w.word]}</div>}
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="p-3 align-top">
                      <div className="flex flex-col gap-2">
                        {w.globalChoices && w.globalChoices.map((choice: string, cIdx: number) => (
                          <div key={cIdx} className="flex items-center gap-2 p-1.5 bg-white dark:bg-gray-900 border dark:border-gray-700 rounded">
                            <span className="font-mono text-xs flex-1 truncate">{choice}</span>
                            <button className="px-2 py-0.5 text-[10px] bg-gray-200 dark:bg-gray-700 rounded hover:bg-gray-300" onClick={() => handleListen(w.word, choice)}>🔊</button>
                            <button className="px-2 py-0.5 text-[10px] bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-200 rounded" onClick={() => handleSaveOverride(w.word, choice)}>Adopt</button>
                          </div>
                        ))}
                      </div>
                    </td>
                    <td className="p-3 align-top">
                      {editingWord === w.word ? (
                         <div className="flex flex-col gap-1">
                           <input 
                             type="text" 
                             value={editValue} 
                             onChange={e => setEditValue(e.target.value)} 
                             className="p-1 text-sm border rounded bg-white dark:bg-gray-900 dark:border-gray-700" 
                           />
                           <div className="flex gap-1">
                             <button className="px-2 py-1 text-xs bg-green-600 text-white rounded" onClick={() => handleSaveOverride(w.word, editValue)}>Save</button>
                             <button className="px-2 py-1 text-xs bg-gray-300 text-gray-800 rounded" onClick={() => setEditingWord(null)}>Cancel</button>
                           </div>
                         </div>
                      ) : (
                         <div className="flex flex-col gap-1 items-start">
                           <span className="font-mono text-sm text-blue-600 dark:text-blue-400 font-bold">{w.userOverride || '-'}</span>
                           {w.userOverride && (
                             <>
                               <button className="px-2 py-0.5 text-[10px] bg-gray-200 dark:bg-gray-700 rounded hover:bg-gray-300" onClick={() => handleListen(w.word, w.userOverride)}>Listen 🔊</button>
                               <button 
                                 className="px-2 py-0.5 text-[10px] bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200 rounded hover:opacity-80 disabled:opacity-50" 
                                 onClick={() => handleBatchReplace(w.word, w.userOverride)}
                                 disabled={!!batchReplaceStatus[w.word]}
                                 title="Updates this word in ALL audiobook text chunks to use this phonetic"
                               >
                                 Batch Replace in Books ⚡
                               </button>
                               {batchReplaceStatus[w.word] && (
                                 <div className="text-[10px] text-orange-600 dark:text-orange-400 font-medium">{batchReplaceStatus[w.word]}</div>
                               )}
                             </>
                           )}
                           <button className="px-2 py-0.5 text-[10px] bg-gray-200 dark:bg-gray-700 rounded hover:bg-gray-300" onClick={() => { setEditingWord(w.word); setEditValue(w.userOverride || ''); }}>Custom Edit</button>
                         </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filteredWords.length > maxRender && (
              <div className="p-4 text-center text-sm text-gray-500 font-medium">
                Showing top {maxRender} of {filteredWords.length} results. Type to search for a specific word.
              </div>
            )}
            </>
          )}
        </div>
      </div>
    </ModalFrame>
  );
}
