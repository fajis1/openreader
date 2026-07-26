import React, { useState, useEffect } from 'react';
import { ModalFrame } from '@/components/ui';
import toast from 'react-hot-toast';

export function ScanForeignWordsModal({
  isOpen,
  onClose,
  documentId,
  documentName
}: {
  isOpen: boolean;
  onClose: () => void;
  documentId?: string | null;
  documentName?: string | null;
}) {
  const [activeDocId, setActiveDocId] = useState<string | null>(documentId || null);
  const [activeDocName, setActiveDocName] = useState<string | null>(documentName || null);
  const [documents, setDocuments] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [words, setWords] = useState<any[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Map to store temporary inline edits before saving
  const [editingWord, setEditingWord] = useState<string | null>(null);
  const [editValue, setEditValue] = useState<string>('');

  const [feedbackExamples, setFeedbackExamples] = useState<string[]>([]);
  const [refineInput, setRefineInput] = useState<{ [word: string]: string }>({});
  const [refineStatus, setRefineStatus] = useState<{ [word: string]: string }>({});
  const [refineExpanded, setRefineExpanded] = useState<{ [word: string]: boolean }>({});

  useEffect(() => {
    if (isOpen) {
      loadFeedbackExamples();
      if (documentId) {
        setActiveDocId(documentId);
        setActiveDocName(documentName || null);
        loadWords(documentId);
      } else {
        loadDocuments();
      }
    } else {
      setWords([]);
      setError(null);
      setActiveDocId(null);
      setActiveDocName(null);
    }
  }, [isOpen, documentId, documentName]);

  const loadFeedbackExamples = async () => {
    try {
      const res = await fetch('/api/tts/refine-pronunciations');
      if (res.ok) {
        const data = await res.json();
        if (data.feedbackExamples) setFeedbackExamples(data.feedbackExamples);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const loadDocuments = async () => {
    try {
      const res = await fetch('/api/documents');
      const data = await res.json();
      setDocuments((data.documents || []).filter((d: any) => d.type === 'pdf'));
    } catch (err) {
      console.error(err);
    }
  };

  const [scanMode, setScanMode] = useState<'all_foreign' | 'fantasy_litrpg' | 'greek_hebrew' | 'custom'>('all_foreign');
  const [scanCoverage, setScanCoverage] = useState<number>(80);
  const [customQuery, setCustomQuery] = useState<string>('');

  const loadWords = async (targetId: string, overrideMode?: string, overrideCoverage?: number, overrideQuery?: string) => {
    setLoading(true);
    setError(null);
    try {
      const modeToUse = overrideMode || scanMode;
      const coverageToUse = overrideCoverage !== undefined ? overrideCoverage : scanCoverage;
      const queryToUse = overrideQuery !== undefined ? overrideQuery : customQuery;

      const res = await fetch('/api/documents/scan-foreign-words', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          documentId: targetId,
          mode: modeToUse,
          target: coverageToUse,
          query: queryToUse
        }),
      });
      if (!res.ok) throw new Error('Failed to scan document');
      const data = await res.json();
      setWords(data.words || []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleListen = async (word: string, phonetic: string) => {
    try {
      const textToSynthesize = phonetic ? (phonetic.startsWith('/') ? `[${word}](${phonetic})` : `[${word}](/${phonetic}/)`) : word;
      const res = await fetch(`/api/tts/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: textToSynthesize, voice: 'af_heart' })
      });
      if (!res.ok) throw new Error('TTS Preview failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.play();
    } catch (e) {
      console.error('Failed to listen', e);
    }
  };

  const handleSaveOverride = async (word: string, newPronunciation: string) => {
    try {
      // We need to fetch current profiles, update active, then save back.
      // Wait, there is no endpoint to just update a single word in the active profile.
      // We have POST /api/tts-settings to save all profiles.
      const profilesRes = await fetch('/api/tts-settings');
      const profilesData = await profilesRes.json();
      
      const updatedProfiles = profilesData.smartAudioProfiles.map((p: any) => {
        if (p.id === profilesData.selectedSmartAudioProfileId) {
          return {
            ...p,
            pronunciations: {
              ...p.pronunciations,
              [word]: newPronunciation
            }
          };
        }
        return p;
      });

      await fetch('/api/tts-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          selectedSmartAudioProfileId: profilesData.selectedSmartAudioProfileId,
          smartAudioProfiles: updatedProfiles
        })
      });

      // Also post to global pronunciations
      await fetch('/api/tts/global-pronunciations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ word, phonetic: newPronunciation })
      });

      // Update local state
      setWords(words.map(w => w.word === word ? { ...w, userOverride: newPronunciation } : w));
      setEditingWord(null);
    } catch (e) {
      console.error('Failed to save override', e);
    }
  };

  const handleRefine = async (word: string, customPrompt?: string) => {
    const feedback = customPrompt || refineInput[word] || "Generate 5 clean, standard Kokoro IPA pronunciations for this word";

    setRefineStatus(prev => ({ ...prev, [word]: 'Step 1/2: Asking Gemini 3.6 Flash for 5 new variations based on your feedback...' }));
    
    try {
      const wObj = words.find(w => w.word === word);
      const currentChoices = (Array.isArray(wObj?.pronunciations) ? wObj.pronunciations : []).map((p: any) => p.phonetic || p);
      
      const res = await fetch('/api/tts/refine-pronunciations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ word, feedback, currentChoices }),
      });
      
      setRefineStatus(prev => ({ ...prev, [word]: 'Step 2/2: Pre-rendering Kokoro audio buffers for instant playback...' }));
      
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || 'Refinement failed');
      }
      const data = await res.json();
      
      if (data.feedbackExamples) {
        setFeedbackExamples(data.feedbackExamples);
      }
      
      if (data.newChoices) {
        setWords(prev => prev.map(w => {
          if (w.word === word) {
            const newProns = data.newChoices.map((c: string) => ({ phonetic: c, usageCount: 0 }));
            return { ...w, pronunciations: [...(w.pronunciations || []), ...newProns] };
          }
          return w;
        }));
      }
    } catch (e: any) {
      console.error('Failed to refine', e);
      const errMsg = e.message || 'Failed to generate choices';
      toast.error(errMsg, { duration: 6000 });

      // Live countdown timer for rate limits / server overload
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
    } finally {
      setRefineInput(prev => ({ ...prev, [word]: '' }));
    }
  };


  return (
    <ModalFrame open={isOpen} onClose={onClose} size="lg">
      <div className="flex flex-col max-h-[80vh]">
        <div className="p-4 border-b dark:border-gray-800 flex flex-col gap-3">
          <div className="flex justify-between items-center">
            <div>
              <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100">Foreign & Custom Word Pronunciation Pre-Scan 🔍</h3>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {activeDocName ? `Scanning ${activeDocName}` : "Select a PDF to scan"}
              </p>
            </div>
            <button onClick={onClose} className="text-gray-500 hover:text-gray-800 dark:hover:text-gray-200 text-lg font-bold">✕</button>
          </div>

          {activeDocId && (
            <div className="flex flex-wrap items-center justify-between gap-3 p-3 bg-gray-50 dark:bg-gray-800/60 rounded-lg border border-gray-200 dark:border-gray-700">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">Target Type:</span>
                <select
                  value={scanMode}
                  onChange={(e: any) => {
                    const newMode = e.target.value;
                    setScanMode(newMode);
                    if (activeDocId) loadWords(activeDocId, newMode);
                  }}
                  className="px-2.5 py-1 text-xs border rounded bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 border-gray-300 dark:border-gray-700 font-medium"
                >
                  <option value="all_foreign">🌐 All Foreign Languages (Greek, Hebrew, Cyrillic, CJK, etc.)</option>
                  <option value="fantasy_litrpg">⚔️ Fantasy & LitRPG (Proper Nouns, Stat Names, Races)</option>
                  <option value="greek_hebrew">🏛️ Biblical Scholarship (Greek & Hebrew Only)</option>
                  <option value="custom">🔍 Custom Term Search</option>
                </select>

                {scanMode === 'custom' && (
                  <input
                    type="text"
                    value={customQuery}
                    onChange={(e) => setCustomQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && activeDocId) loadWords(activeDocId);
                    }}
                    placeholder="Enter word to search (e.g. Xylar)"
                    className="px-2.5 py-1 text-xs border rounded bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 border-gray-300 dark:border-gray-700"
                  />
                )}
              </div>

              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">Coverage:</span>
                <div className="inline-flex rounded-md shadow-sm">
                  <button
                    type="button"
                    onClick={() => {
                      setScanCoverage(80);
                      if (activeDocId) loadWords(activeDocId, undefined, 80);
                    }}
                    className={`px-3 py-1 text-xs font-bold rounded-l-md border ${
                      scanCoverage === 80
                        ? 'bg-blue-600 text-white border-blue-600'
                        : 'bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-700 hover:bg-gray-100'
                    }`}
                  >
                    Top 80% (Recommended)
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setScanCoverage(100);
                      if (activeDocId) loadWords(activeDocId, undefined, 100);
                    }}
                    className={`px-3 py-1 text-xs font-bold rounded-r-md border-t border-b border-r ${
                      scanCoverage === 100
                        ? 'bg-blue-600 text-white border-blue-600'
                        : 'bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-700 hover:bg-gray-100'
                    }`}
                  >
                    Full 100%
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => activeDocId && loadWords(activeDocId)}
                  className="px-3 py-1 bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 text-gray-800 dark:text-gray-200 font-bold text-xs rounded transition-colors"
                >
                  🔄 Rescan
                </button>
              </div>
            </div>
          )}
        </div>
        <div className="p-4 overflow-y-auto flex-1">
          {!activeDocId ? (
            <div className="space-y-4">
              <p className="text-sm text-gray-600 dark:text-gray-400">Choose a PDF from your library to scan for foreign words:</p>
              <div className="flex flex-col gap-2">
                {documents.map(doc => (
                  <button 
                    key={doc.id} 
                    type="button"
                    className="p-3 text-left border rounded-lg bg-gray-50 dark:bg-gray-800 hover:bg-blue-50 dark:hover:bg-blue-900/30 transition-colors font-medium text-sm flex items-center gap-2"
                    onClick={() => {
                      setActiveDocId(doc.id);
                      setActiveDocName(doc.name);
                      loadWords(doc.id);
                    }}
                  >
                    📄 {doc.name}
                  </button>
                ))}
                {documents.length === 0 && <p className="text-sm text-gray-500">No PDFs found in your library.</p>}
              </div>
            </div>
          ) : loading ? (
            <div className="flex flex-col items-center justify-center p-12 text-center">
              <div className="text-gray-900 dark:text-gray-100 font-semibold mb-2 text-lg">Scanning document (this may take a minute)...</div>
              <p className="text-gray-500 dark:text-gray-400 text-sm max-w-md">
                You can safely close this modal or navigate away. The scan will continue in the background, and all LLM pronunciation generations will automatically be saved to your database for when you return!
              </p>
            </div>
          ) : error ? (
            <div className="p-4 text-red-600 bg-red-50 dark:bg-red-950/40 rounded">{error}</div>
          ) : words.length === 0 ? (
            <div className="p-4 text-gray-500">No foreign words found.</div>
          ) : (
            <table className="w-full text-sm text-left">
              <thead className="bg-gray-100 dark:bg-gray-800 sticky top-0">
                <tr>
                  <th className="px-4 py-2">Word</th>
                  <th className="px-4 py-2 text-right">Count</th>
                  <th className="px-4 py-2">AI Pronunciation Options</th>
                  <th className="px-4 py-2">Your Override</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                {words.map((w, i) => (
                  <tr key={i} className="hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
                    <td className="px-4 py-3 font-medium text-lg text-gray-900 dark:text-gray-100 align-top">{w.word}</td>
                    <td className="px-4 py-3 text-right text-gray-500 align-top">{w.count}</td>
                    <td className="px-4 py-3 align-top">
                      <div className="flex flex-col gap-2">
                        {(Array.isArray(w.pronunciations) ? w.pronunciations : []).map((p: any, idx: number) => {
                          const phoneticStr = p.phonetic || p;
                          const isMatch = w.userOverride === phoneticStr;
                          return (
                            <div key={idx} className={`flex items-center gap-2 p-1.5 rounded border ${isMatch ? 'bg-blue-100 border-blue-300 dark:bg-blue-900/30 dark:border-blue-800' : 'border-transparent hover:border-gray-200 dark:hover:border-gray-700'}`}>
                              <span className="font-mono text-purple-600 dark:text-purple-400 text-xs flex-1">
                                {phoneticStr}
                              </span>
                              <button
                                type="button"
                                className="px-2 py-0.5 text-[10px] font-semibold bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded hover:bg-gray-300"
                                onClick={() => handleListen(w.word, phoneticStr)}
                              >
                                Listen
                              </button>
                              <button
                                type="button"
                                className="px-2 py-0.5 text-[10px] font-semibold bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300 rounded hover:bg-blue-200"
                                onClick={() => handleSaveOverride(w.word, phoneticStr)}
                              >
                                Adopt
                              </button>
                            </div>
                          );
                        })}
                        {(!w.pronunciations || w.pronunciations.length === 0) && (
                          <span className="text-gray-500 text-xs italic">No AI pronunciations found.</span>
                        )}
                      </div>
                      
                      {/* Refinement Section */}
                      <div className="mt-4 pt-3 border-t border-gray-200 dark:border-gray-700">
                        <button
                          type="button"
                          className="text-xs text-blue-600 dark:text-blue-400 font-medium hover:underline flex items-center gap-1"
                          onClick={() => {
                            const isOpening = !refineExpanded[w.word];
                            setRefineExpanded(prev => ({ ...prev, [w.word]: isOpening }));
                            if (isOpening && (!w.pronunciations || w.pronunciations.length === 0)) {
                              void handleRefine(w.word);
                            }
                          }}
                        >
                          {refineExpanded[w.word] ? '▼ Hide Refinement' : '▶ Refine with AI'}
                        </button>
                        
                        {refineExpanded[w.word] && (
                          <div className="mt-2 flex flex-col gap-2">
                            <input
                              type="text"
                              value={refineInput[w.word] || ''}
                              onChange={e => setRefineInput(prev => ({ ...prev, [w.word]: e.target.value }))}
                              placeholder="e.g. Make the ending sound like -een instead of -ayn"
                              className="w-full px-2 py-1.5 text-sm border rounded bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 border-gray-300 dark:border-gray-700"
                            />
                            
                            {feedbackExamples.length > 0 && (
                              <div className="flex flex-col gap-1">
                                <span className="text-[10px] text-gray-500 font-medium uppercase tracking-wider">Recent Community Feedback Examples:</span>
                                <div className="flex flex-wrap gap-1">
                                  {feedbackExamples.map((ex, idx) => (
                                    <button
                                      key={idx}
                                      type="button"
                                      className="px-2 py-1 text-[10px] bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 rounded-full hover:bg-gray-200 dark:hover:bg-gray-700 text-left border border-gray-200 dark:border-gray-700 max-w-full truncate"
                                      onClick={() => {
                                        setRefineInput(prev => ({ ...prev, [w.word]: ex }));
                                        void handleRefine(w.word, ex);
                                      }}
                                      title={ex}
                                    >
                                      {ex}
                                    </button>
                                  ))}
                                </div>
                              </div>
                            )}
                            
                            <button
                              type="button"
                              className="self-start mt-1 px-3 py-1.5 text-xs font-semibold bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300 border border-purple-300 dark:border-purple-800 rounded hover:bg-purple-200 dark:hover:bg-purple-900/60 transition-colors disabled:opacity-50"
                              onClick={() => handleRefine(w.word)}
                              disabled={!!refineStatus[w.word]}
                            >
                              Generate 5 New Variations ✨
                            </button>
                            
                            {refineStatus[w.word] && (
                              <span className="text-xs text-amber-600 dark:text-amber-400 font-medium animate-pulse mt-1">
                                {refineStatus[w.word]}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 align-top">
                      {editingWord === w.word ? (
                        <div className="flex flex-col gap-2">
                          <input
                            type="text"
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            className="w-full px-2 py-1 text-sm border rounded bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 border-blue-500"
                            autoFocus
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleSaveOverride(w.word, editValue);
                              if (e.key === 'Escape') setEditingWord(null);
                            }}
                          />
                          <div className="flex gap-2">
                            <button
                              type="button"
                              className="px-2.5 py-1 text-xs font-semibold bg-green-600 text-white rounded hover:bg-green-700"
                              onClick={() => handleSaveOverride(w.word, editValue)}
                            >
                              Save
                            </button>
                            <button
                              type="button"
                              className="px-2.5 py-1 text-xs font-semibold bg-gray-200 text-gray-800 rounded hover:bg-gray-300"
                              onClick={() => setEditingWord(null)}
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex flex-col gap-2">
                          <span className="font-medium text-blue-600 dark:text-blue-400 font-mono text-xs">{w.userOverride || '-'}</span>
                          {w.userOverride && (
                            <button
                                type="button"
                                className="px-2 py-0.5 text-[10px] font-semibold bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded hover:bg-gray-300 self-start"
                                onClick={() => handleListen(w.word, w.userOverride)}
                              >
                                Listen Override
                              </button>
                          )}
                          <button
                            type="button"
                            className="px-2.5 py-1 text-[10px] font-semibold bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded hover:bg-gray-300 dark:hover:bg-gray-600 self-start"
                            onClick={() => {
                              setEditingWord(w.word);
                              setEditValue(w.userOverride || '');
                            }}
                          >
                            Custom Edit
                          </button>
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
