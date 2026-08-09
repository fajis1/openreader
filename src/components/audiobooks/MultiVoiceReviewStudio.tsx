import React, { useState, useEffect, useRef } from 'react';
import {
  KOKORO_CHARACTER_VOICES,
  parseVoiceTaggedText,
} from '@/lib/shared/multi-voice';
import type { SmartAudioCharacterMap, SmartAudioReviewFlag } from '@/types/document-settings';

interface Segment {
  id: string;
  voice: string;
  text: string;
}

interface MultiVoiceReviewStudioProps {
  bookId: string;
  chapterIndex: number;
  initialText: string;
  onSaveAndRegenerate: (newXmlText: string) => Promise<void>;
  onClose: () => void;
  onRebuildAllModified?: () => Promise<void>;
  isRebuildingAll?: boolean;
}

export function MultiVoiceReviewStudio({
  bookId,
  chapterIndex,
  initialText,
  onClose,
  onSaveAndRegenerate,
  onRebuildAllModified,
  isRebuildingAll,
}: MultiVoiceReviewStudioProps) {
  const [segments, setSegments] = useState<Segment[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [cursorPos, setCursorPos] = useState<{ id: string, start: number } | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [playingSegmentId, setPlayingSegmentId] = useState<string | null>(null);
  const [voiceCharacters, setVoiceCharacters] = useState<Record<string, string[]>>({});
  const [reviewFlags, setReviewFlags] = useState<SmartAudioReviewFlag[]>([]);
  const [reviewFlagError, setReviewFlagError] = useState<string | null>(null);
  const [studioError, setStudioError] = useState<string | null>(null);
  const [initialParseWarning, setInitialParseWarning] = useState<string | null>(null);
  const previewAudioUrl = useRef<string | null>(null);
  
  // Dictionary Modal State
  const [showDictModal, setShowDictModal] = useState(false);
  const [dictWord, setDictWord] = useState('');
  const [dictPhonetic, setDictPhonetic] = useState('');
  const [isSavingDict, setIsSavingDict] = useState(false);
  const [isSuggesting, setIsSuggesting] = useState(false);

  useEffect(() => {
    try {
      const parsed = parseVoiceTaggedText(initialText);
      setSegments(parsed.map((segment) => ({
        id: Math.random().toString(),
        voice: segment.voiceId,
        text: segment.text,
      })));
      setInitialParseWarning(null);
    } catch {
      const recoverableText = initialText.replace(/<\/?voice\b[^>]*>/giu, '').trim();
      setSegments(recoverableText ? [{
        id: Math.random().toString(),
        voice: KOKORO_CHARACTER_VOICES[0],
        text: recoverableText,
      }] : []);
      setInitialParseWarning('The saved speaker markup was malformed. Its tags were removed so you can safely rebuild this chapter.');
    }
    setStudioError(null);
    setIsDirty(false);
  }, [initialText]);

  useEffect(() => () => {
    if (previewAudioUrl.current) URL.revokeObjectURL(previewAudioUrl.current);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void fetch(`/api/documents/${encodeURIComponent(bookId)}/settings`, { cache: 'no-store' })
      .then(async (response) => response.ok ? response.json() : null)
      .then((body) => {
        if (cancelled) return;
        const map = body?.settings?.smartAudioCharacters as SmartAudioCharacterMap | undefined;
        if (!map?.entries) return;
        const labels: Record<string, string[]> = {};
        for (const entry of Object.values(map.entries)) {
          const primary = entry.aliasFor ? map.entries[entry.aliasFor] : entry;
          if (!primary?.voiceId) continue;
          labels[primary.voiceId] = Array.from(new Set([...(labels[primary.voiceId] || []), entry.name]));
        }
        setVoiceCharacters(labels);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [bookId]);

  useEffect(() => {
    let cancelled = false;
    setReviewFlagError(null);
    void fetch(`/api/audiobook/review-flags?documentId=${encodeURIComponent(bookId)}&chapterIndex=${chapterIndex}`, {
      cache: 'no-store',
    }).then(async (response) => {
      const body = await response.json().catch(() => ({})) as { flags?: SmartAudioReviewFlag[]; error?: string };
      if (!response.ok) throw new Error(body.error || 'Failed to load review flags.');
      if (!cancelled) setReviewFlags(Array.isArray(body.flags) ? body.flags : []);
    }).catch((error) => {
      if (!cancelled) setReviewFlagError(error instanceof Error ? error.message : 'Failed to load review flags.');
    });
    return () => { cancelled = true; };
  }, [bookId, chapterIndex]);

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!isDirty) return;
      event.preventDefault();
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [isDirty]);

  const updateSegment = (id: string, updates: Partial<Segment>) => {
    setSegments(prev => prev.map(s => s.id === id ? { ...s, ...updates } : s));
    setIsDirty(true);
  };

  const handleSplitSegment = (id: string) => {
    if (!cursorPos || cursorPos.id !== id || cursorPos.start === 0) return;
    
    setSegments(prev => {
      const index = prev.findIndex(s => s.id === id);
      if (index === -1) return prev;
      
      const target = prev[index];
      if (cursorPos.start >= target.text.length) return prev; // Don't split at the very end
      
      const text1 = target.text.slice(0, cursorPos.start).trim();
      const text2 = target.text.slice(cursorPos.start).trim();
      
      const newSegments = [...prev];
      // Update original
      newSegments[index] = { ...target, text: text1 };
      // Insert new segment right after
      newSegments.splice(index + 1, 0, {
        id: Math.random().toString(),
        voice: target.voice,
        text: text2
      });
      
      return newSegments;
    });
    setIsDirty(true);
    setCursorPos(null);
  };

  const insertTextAtCursor = (id: string, textToInsert: string) => {
    if (!cursorPos || cursorPos.id !== id) return;
    
    setSegments(prev => {
      const index = prev.findIndex(s => s.id === id);
      if (index === -1) return prev;
      
      const target = prev[index];
      const before = target.text.slice(0, cursorPos.start);
      const after = target.text.slice(cursorPos.start);
      
      const newSegments = [...prev];
      newSegments[index] = { ...target, text: before + textToInsert + after };
      return newSegments;
    });
    
    // Update cursor pos to after the inserted text
    setCursorPos(prev => prev ? { ...prev, start: prev.start + textToInsert.length } : null);
    setIsDirty(true);
  };

  const removeSegment = (id: string) => {
    setSegments((current) => current.filter((segment) => segment.id !== id));
    setIsDirty(true);
  };

  const mergeWithNext = (id: string) => {
    setSegments((current) => {
      const index = current.findIndex((segment) => segment.id === id);
      if (index < 0 || index >= current.length - 1) return current;
      const next = [...current];
      next[index] = { ...next[index], text: `${next[index].text}\n\n${next[index + 1].text}`.trim() };
      next.splice(index + 1, 1);
      return next;
    });
    setIsDirty(true);
  };

  const previewSegment = async (segment: Segment) => {
    setPlayingSegmentId(segment.id);
    try {
      const response = await fetch('/api/tts/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: segment.text.slice(0, 500), voice: segment.voice }),
      });
      if (!response.ok) throw new Error('Preview failed');
      if (previewAudioUrl.current) URL.revokeObjectURL(previewAudioUrl.current);
      const url = URL.createObjectURL(await response.blob());
      previewAudioUrl.current = url;
      const audio = new Audio(url);
      const finish = () => {
        URL.revokeObjectURL(url);
        if (previewAudioUrl.current === url) previewAudioUrl.current = null;
        setPlayingSegmentId(null);
      };
      audio.onended = finish;
      audio.onerror = finish;
      await audio.play();
    } catch (error) {
      setStudioError(error instanceof Error ? error.message : 'Voice preview failed.');
      setPlayingSegmentId(null);
    }
  };

  const requestClose = () => {
    if (isDirty && !window.confirm('Discard unsaved character voice edits?')) return;
    onClose();
  };

  const resolveReviewFlag = async (flagId: string) => {
    setReviewFlagError(null);
    try {
      const response = await fetch('/api/audiobook/review-flags', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ documentId: bookId, flagId }),
      });
      const body = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(body.error || 'Failed to resolve the review flag.');
      setReviewFlags((current) => current.filter((flag) => flag.id !== flagId));
    } catch (error) {
      setReviewFlagError(error instanceof Error ? error.message : 'Failed to resolve the review flag.');
    }
  };

  const formatFlagTime = (timestampMs: number) => {
    const seconds = Math.floor(timestampMs / 1_000);
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  };

  const handleSave = async () => {
    setIsSaving(true);
    setStudioError(null);
    try {
      // Reconstruct the XML text
      const newXml = segments
        .filter(s => s.text.trim())
        .map(s => `<voice name="${s.voice}">${s.text.trim()}</voice>`)
        .join('\n\n');
        
      await onSaveAndRegenerate(newXml);
      setIsDirty(false);
    } catch (error) {
      setStudioError(error instanceof Error ? error.message : 'Failed to regenerate the chapter.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveDictionary = async () => {
    if (!dictWord.trim() || !dictPhonetic.trim()) return;
    setIsSavingDict(true);
    try {
      // Format to Kokoro IPA format if missing slashes
      let phonetic = dictPhonetic.trim();
      if (!phonetic.startsWith('/')) phonetic = '/' + phonetic;
      if (!phonetic.endsWith('/')) phonetic = phonetic + '/';
      
      const res = await fetch('/api/tts/global-pronunciations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ word: dictWord.trim(), phonetic })
      });
      if (res.ok) {
        setShowDictModal(false);
        setDictWord('');
        setDictPhonetic('');
      }
    } finally {
      setIsSavingDict(false);
    }
  };

  const handleSuggestPhonetic = async () => {
    if (!dictWord.trim()) return;
    setIsSuggesting(true);
    try {
      const res = await fetch('/api/tts/refine-pronunciations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          word: dictWord.trim(), 
          feedback: "Provide the most accurate Kokoro IPA phonetic spelling for this word.",
          currentChoices: [] 
        })
      });
      if (res.ok) {
        const data = await res.json();
        if (data.newChoices && data.newChoices.length > 0) {
          setDictPhonetic(data.newChoices[0]);
        }
      }
    } finally {
      setIsSuggesting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-zinc-950 flex flex-col animate-in fade-in duration-300">
      
      {/* Top Navbar */}
      <div className="h-16 border-b border-zinc-800 bg-zinc-900 flex items-center justify-between px-6 shrink-0 shadow-sm shadow-black/50 z-10">
        <div>
          <h1 className="text-xl font-bold text-white tracking-tight">Audio-Drama Studio</h1>
          <p className="text-xs text-zinc-400 font-medium tracking-wide uppercase">Chapter {chapterIndex + 1}</p>
        </div>
        <div className="flex items-center gap-4">
          <button 
            onClick={requestClose}
            className="px-4 py-2 text-sm font-medium text-zinc-400 hover:text-white transition-colors"
          >
            Exit Studio
          </button>
          <button 
            onClick={() => setShowDictModal(true)}
            className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-sm font-semibold rounded-full shadow-lg transition-all flex items-center gap-2"
          >
            📖 Add to Dictionary
          </button>
          {onRebuildAllModified && (
            <button
              onClick={onRebuildAllModified}
              disabled={isRebuildingAll || isSaving}
              className="px-4 py-2 bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white text-sm font-semibold rounded-full shadow-lg transition-all flex items-center gap-2"
              title="Automatically rebuild the TTS audio for any text chunk that was modified via the Dictionary or text edits"
            >
              {isRebuildingAll ? "Scanning..." : "Rebuild Modified Audio 🔄"}
            </button>
          )}
          <button 
            onClick={() => void handleSave()}
            disabled={isSaving || isRebuildingAll || !segments.some((segment) => segment.text.trim())}
            className="px-6 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-semibold rounded-full shadow-lg shadow-indigo-500/20 transition-all flex items-center gap-2"
          >
            {isSaving ? 'Regenerating...' : '💾 Save & Regenerate Audio'}
          </button>
        </div>
      </div>

      {(reviewFlags.length > 0 || reviewFlagError) && (
        <div className="border-b border-zinc-800 bg-amber-950/40 px-6 py-3 text-sm text-amber-100">
          {reviewFlagError && <p className="mb-2 text-red-300">{reviewFlagError}</p>}
          {reviewFlags.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold">🚩 Mobile review flags:</span>
              {reviewFlags.map((flag) => (
                <span key={flag.id} className="inline-flex items-center gap-2 rounded-full border border-amber-700/60 bg-zinc-900 px-3 py-1">
                  <span>{formatFlagTime(flag.timestampMs)}</span>
                  <button type="button" onClick={() => void resolveReviewFlag(flag.id)} className="text-xs text-amber-300 hover:text-white">Mark resolved</button>
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {(initialParseWarning || studioError) && (
        <div className="border-b border-zinc-800 bg-red-950/40 px-6 py-3 text-sm text-red-200">
          {initialParseWarning || studioError}
        </div>
      )}

      {/* Main Content Area */}
      <div className="flex-1 overflow-y-auto bg-zinc-950 p-6 sm:p-10">
        <div className="max-w-4xl mx-auto space-y-6 pb-32">
          {segments.map((segment, index) => (
            <div 
              key={segment.id} 
              className="group flex gap-4 p-5 rounded-2xl border border-zinc-800/50 bg-zinc-900/50 hover:bg-zinc-900 hover:border-indigo-500/30 transition-all shadow-sm"
            >
              {/* Left Column: Character / Voice Dropdown */}
              <div className="w-56 shrink-0 flex flex-col gap-2">
                <label className="text-[11px] font-bold text-zinc-500 uppercase tracking-wider">
                  Speaker Voice
                </label>
                <select 
                  value={segment.voice}
                  onChange={e => updateSegment(segment.id, { voice: e.target.value })}
                  className="w-full bg-zinc-950 border border-zinc-800 text-sm rounded-xl p-2.5 text-indigo-300 focus:ring-2 focus:ring-indigo-500 outline-none transition-all shadow-inner font-medium"
                >
                  {KOKORO_CHARACTER_VOICES.map(v => (
                    <option key={v} value={v}>{voiceCharacters[v]?.length ? `${voiceCharacters[v].join(', ')} — ${v}` : v}</option>
                  ))}
                </select>
                <button type="button" onClick={() => void previewSegment(segment)} disabled={playingSegmentId === segment.id} className="rounded-lg border border-zinc-700 px-2 py-1 text-xs text-indigo-300 disabled:opacity-50">
                  {playingSegmentId === segment.id ? 'Playing…' : '▶ Preview'}
                </button>
                <div className="flex gap-2">
                  <button type="button" onClick={() => mergeWithNext(segment.id)} disabled={index === segments.length - 1} className="text-[10px] text-zinc-500 hover:text-white disabled:opacity-30">Merge next</button>
                  <button type="button" onClick={() => removeSegment(segment.id)} className="text-[10px] text-red-400 hover:text-red-300">Delete</button>
                </div>
                <div className="text-[10px] text-zinc-600 font-medium px-1">
                  Segment #{index + 1}
                </div>
              </div>

              {/* Right Column: Editable Text */}
              <div className="flex-1 flex flex-col gap-2">
                <label className="text-[11px] font-bold text-zinc-500 uppercase tracking-wider flex justify-between items-center">
                  <span>Dialogue / Narration</span>
                  <div className="flex items-center gap-3">
                    {cursorPos?.id === segment.id && (
                      <div className="flex items-center gap-1 mr-2 bg-zinc-950 rounded p-1 border border-zinc-800">
                        <button onClick={() => insertTextAtCursor(segment.id, 'ˈ')} className="text-xs text-zinc-400 hover:text-white px-2 hover:bg-zinc-800 rounded" title="Primary Stress">ˈ Stress</button>
                        <button onClick={() => insertTextAtCursor(segment.id, 'ˌ')} className="text-xs text-zinc-400 hover:text-white px-2 hover:bg-zinc-800 rounded" title="Secondary Stress">ˌ Sub-stress</button>
                        <button onClick={() => insertTextAtCursor(segment.id, '(-1)')} className="text-xs text-zinc-400 hover:text-white px-2 hover:bg-zinc-800 rounded" title="Lower Volume/Intensity">(-1) Softer</button>
                        <button onClick={() => insertTextAtCursor(segment.id, '(+1)')} className="text-xs text-zinc-400 hover:text-white px-2 hover:bg-zinc-800 rounded" title="Raise Volume/Intensity">(+1) Louder</button>
                      </div>
                    )}
                    {cursorPos?.id === segment.id && (
                      <button 
                        onClick={() => handleSplitSegment(segment.id)}
                        className="text-xs bg-zinc-800 hover:bg-indigo-600 text-zinc-300 hover:text-white px-2 py-1 rounded transition-colors"
                        title="Split into two separate voices at cursor"
                      >
                        ✂️ Split at Cursor
                      </button>
                    )}
                    <span className="text-zinc-600 opacity-0 group-hover:opacity-100 transition-opacity">Editable</span>
                  </div>
                </label>
                <textarea 
                  value={segment.text}
                  onChange={e => updateSegment(segment.id, { text: e.target.value })}
                  onSelect={e => setCursorPos({ id: segment.id, start: e.currentTarget.selectionStart })}
                  onBlur={() => {
                    // Small delay so the button click registers before cursor state clears
                    setTimeout(() => {
                      if (cursorPos?.id === segment.id) setCursorPos(null);
                    }, 200);
                  }}
                  className="w-full bg-transparent border-0 text-zinc-200 text-base leading-relaxed resize-none focus:ring-0 p-0 placeholder-zinc-700 min-h-[80px]"
                  placeholder="Enter dialogue here..."
                  style={{ height: `${Math.max(80, segment.text.split('\n').length * 24)}px` }}
                />
              </div>
            </div>
          ))}
          <button
            type="button"
            onClick={() => {
              setSegments((current) => [...current, { id: Math.random().toString(), voice: KOKORO_CHARACTER_VOICES[0], text: '' }]);
              setIsDirty(true);
            }}
            className="w-full rounded-xl border border-dashed border-zinc-700 p-3 text-sm text-zinc-400 hover:border-indigo-500 hover:text-indigo-300"
          >
            + Add Speaker Segment
          </button>
        </div>
      </div>
      
      {/* Bottom Sticky Player Bar Placeholder (Integration point for existing audio player) */}
      <div className="fixed bottom-0 left-0 right-0 h-24 border-t border-zinc-800 bg-zinc-950/90 backdrop-blur-xl flex items-center justify-center p-4">
         <p className="text-zinc-500 text-sm flex items-center gap-3">
            <span className="animate-pulse">🎧</span> 
            Continuous playback player will attach here when launched from the Audiobook listener.
         </p>
      </div>

      {/* Dictionary Modal */}
      {showDictModal && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl w-full max-w-sm p-6 flex flex-col gap-4 animate-in fade-in zoom-in-95 duration-200">
            <h3 className="text-lg font-bold text-white">Add Global Pronunciation</h3>
            <p className="text-sm text-zinc-400">Add a unique LitRPG word to fix it across the entire book.</p>
            
            <div className="flex flex-col gap-3 mt-2">
              <input 
                type="text" 
                placeholder="Original Word (e.g. Aetherian)" 
                value={dictWord}
                onChange={e => setDictWord(e.target.value)}
                className="bg-zinc-950 border border-zinc-800 rounded-lg p-3 text-white text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
              />
              <div className="flex gap-2">
                <input 
                  type="text" 
                  placeholder="Phonetic (e.g. /iːθərɪən/)" 
                  value={dictPhonetic}
                  onChange={e => setDictPhonetic(e.target.value)}
                  className="flex-1 bg-zinc-950 border border-zinc-800 rounded-lg p-3 text-white text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                />
                <button 
                  onClick={handleSuggestPhonetic}
                  disabled={isSuggesting || !dictWord}
                  className="px-3 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 text-indigo-400 text-sm font-semibold rounded-lg transition-colors border border-zinc-700"
                  title="Ask Gemini for a suggested pronunciation"
                >
                  {isSuggesting ? '✨...' : '✨ Suggest'}
                </button>
              </div>
            </div>

            <div className="flex justify-end gap-3 mt-4">
              <button onClick={() => setShowDictModal(false)} className="px-4 py-2 text-sm text-zinc-400 hover:text-white">Cancel</button>
              <button 
                onClick={handleSaveDictionary}
                disabled={isSavingDict || !dictWord || !dictPhonetic}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-semibold rounded-lg transition-all"
              >
                {isSavingDict ? 'Saving...' : 'Save Word'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
