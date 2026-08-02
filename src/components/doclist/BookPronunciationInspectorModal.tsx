import React, { useState, useEffect } from 'react';
import { ModalFrame } from '@/components/ui';
import toast from 'react-hot-toast';
import { useTtsPreviewSettings } from '@/hooks/audio/useTtsPreviewSettings';

export function BookPronunciationInspectorModal({
  isOpen,
  onClose,
  initialBookId
}: {
  isOpen: boolean;
  onClose: () => void;
  initialBookId?: string | null;
}) {
  const previewSettings = useTtsPreviewSettings();
  const [selectedBookId, setSelectedBookId] = useState<string>(initialBookId || '');
  const [letterFilter, setLetterFilter] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  
  const [audiobooks, setAudiobooks] = useState<any[]>([]);
  const [words, setWords] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [editingWord, setEditingWord] = useState<string | null>(null);
  const [editValue, setEditValue] = useState<string>('');

  const [refineInput, setRefineInput] = useState<{ [word: string]: string }>({});
  const [refineStatus, setRefineStatus] = useState<{ [word: string]: string }>({});
  const [refineExpanded, setRefineExpanded] = useState<{ [word: string]: boolean }>({});

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
      fetchPronunciations(selectedBookId, letterFilter);
    }
  }, [isOpen, selectedBookId, letterFilter]);

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

  if (!isOpen) return null;

  const filteredWords = words.filter(w => w.word.toLowerCase().includes(searchQuery.toLowerCase()));

  return (
    <ModalFrame open={isOpen} onClose={onClose}>
      <div className="flex flex-col h-full max-h-[80vh] min-w-[600px] bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 p-4">
        
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
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b dark:border-gray-700 bg-gray-100 dark:bg-gray-800 text-sm font-semibold">
                  <th className="p-3 w-1/3">Word</th>
                  <th className="p-3 w-1/3">Global Choices</th>
                  <th className="p-3 w-1/3">My Active Profile</th>
                </tr>
              </thead>
              <tbody>
                {filteredWords.map((w, idx) => (
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
                             <button className="px-2 py-0.5 text-[10px] bg-gray-200 dark:bg-gray-700 rounded hover:bg-gray-300" onClick={() => handleListen(w.word, w.userOverride)}>Listen 🔊</button>
                           )}
                           <button className="px-2 py-0.5 text-[10px] bg-gray-200 dark:bg-gray-700 rounded hover:bg-gray-300" onClick={() => { setEditingWord(w.word); setEditValue(w.userOverride || ''); }}>Custom Edit</button>
                         </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </ModalFrame>
  );
}
