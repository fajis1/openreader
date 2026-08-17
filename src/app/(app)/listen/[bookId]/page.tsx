"use client";

import { useState, useEffect, useRef, use, useMemo } from "react";
import { useRouter } from "next/navigation";
import { HTMLViewer } from "@/components/views/HTMLViewer";
import { parseHtmlBlocks } from "@/lib/client/html/blocks";
import { BookPronunciationInspectorModal } from "@/components/doclist/BookPronunciationInspectorModal";
import { MultiVoiceReviewStudio } from "@/components/audiobooks/MultiVoiceReviewStudio";
import { MobileReviewPlayer } from "@/components/audiobooks/MobileReviewPlayer";
import { BASE_BOOKS } from "@/components/constants";
import { toast } from "react-hot-toast";
import { ModalFrame } from "@/components/ui";
import { SmartAudioSettings } from "@/components/SmartAudioSettings";
import { estimateSpeakerSegmentAtTime, parseVoiceTaggedText, renderVoiceSegments } from "@/lib/shared/multi-voice";
import type { SmartAudioCharacterMap } from "@/types/document-settings";

interface Chapter {
  index: number;
  title: string;
  duration?: number;
  format: string;
}

export default function ListenPage({ params }: { params: Promise<{ bookId: string }> }) {
  const unwrappedParams = use(params);
  const bookId = unwrappedParams.bookId;
  const router = useRouter();

  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentChapterIndex, setCurrentChapterIndex] = useState(0);
  
  const [showLeftPane, setShowLeftPane] = useState(true);
  const [showMiddlePane, setShowMiddlePane] = useState(true);
  const [showRightPane, setShowRightPane] = useState(true);

  const [chapterText, setChapterText] = useState("");
  const [originalText, setOriginalText] = useState("");
  const [hasEditedText, setHasEditedText] = useState(false);
  const [isTextLoading, setIsTextLoading] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [isRebuildingAll, setIsRebuildingAll] = useState(false);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const [isPronunciationModalOpen, setIsPronunciationModalOpen] = useState(false);
  const [isQuickAbbrevModalOpen, setIsQuickAbbrevModalOpen] = useState(false);
  const [newAbbrevKey, setNewAbbrevKey] = useState('');
  const [newAbbrevVal, setNewAbbrevVal] = useState('');
  const [selectedText, setSelectedText] = useState("");
  
  const [showMultiVoiceStudio, setShowMultiVoiceStudio] = useState(false);
  const [showMobilePlayer, setShowMobilePlayer] = useState(false);
  const [smartAudioProfiles, setSmartAudioProfiles] = useState<any[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState<string>('');
  const [cleanTarget, setCleanTarget] = useState<'original' | 'edited'>('edited');
  const [isFixingAll, setIsFixingAll] = useState(false);
  const [isSettingsModalOpen, setIsSettingsModalOpen] = useState(false);
  const [voiceCharacters, setVoiceCharacters] = useState<Record<string, string[]>>({});
  const [castCharacters, setCastCharacters] = useState<Array<{ name: string; voiceId: string }>>([]);
  const [playingSpeakerSegment, setPlayingSpeakerSegment] = useState<number | null>(null);
  const [speakerTextDrafts, setSpeakerTextDrafts] = useState<Record<number, string>>({});
  const [activeSpeakerSegment, setActiveSpeakerSegment] = useState<number | null>(null);

  const isMultiVoice = chapterText.includes('<voice');
  const speakerSegments = useMemo(() => {
    if (!isMultiVoice) return [];
    try {
      return parseVoiceTaggedText(chapterText, { includeOmitted: true }).map((segment, index) => ({
        id: `${index}-${segment.voiceId}`,
        voiceId: segment.voiceId,
        speaker: voiceCharacters[segment.voiceId]?.join(', ') || segment.voiceId,
        text: segment.text,
        omitted: segment.omitted === true,
      }));
    } catch {
      return [];
    }
  }, [chapterText, isMultiVoice, voiceCharacters]);

  useEffect(() => {
    setSpeakerTextDrafts(Object.fromEntries(
      speakerSegments.map((segment, index) => [index, segment.text]),
    ));
  }, [currentChapterIndex, speakerSegments]);

  useEffect(() => {
    setActiveSpeakerSegment(null);
  }, [currentChapterIndex]);

  useEffect(() => {
    if (activeSpeakerSegment === null) return;
    document.getElementById(`drama-speaker-row-${activeSpeakerSegment}`)?.scrollIntoView({
      block: 'nearest',
      behavior: 'smooth',
    });
  }, [activeSpeakerSegment]);

  useEffect(() => {
    const handleOpenSettings = () => setIsSettingsModalOpen(true);
    window.addEventListener('open-smart-audio-settings', handleOpenSettings);
    return () => {
      window.removeEventListener('open-smart-audio-settings', handleOpenSettings);
    };
  }, []);

  const blocks = useMemo(() => {
    // Show original text in middle pane, fallback to chapterText if original isn't ready
    const textToRender = originalText || chapterText;
    if (!textToRender) return [];
    return parseHtmlBlocks(textToRender, true); // true for isTxt
  }, [chapterText, originalText]);

  const fetchStatus = async () => {
    try {
      const res = await fetch(`/api/audiobook/status?bookId=${bookId}`);
      const data = await res.json();
      if (data.chapters && data.chapters.length > 0) {
        setChapters((prev) => {
          // Only update if something changed to avoid unnecessary re-renders
          if (JSON.stringify(prev) !== JSON.stringify(data.chapters)) {
            return data.chapters;
          }
          return prev;
        });
      } else {
        setChapters([]);
      }
    } catch (err) {
      console.error("Failed to fetch audiobook status", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStatus();
    
    const fetchProfiles = async () => {
      try {
        const res = await fetch('/api/tts-settings');
        const data = await res.json();
        if (data.smartAudioProfiles) {
          setSmartAudioProfiles(data.smartAudioProfiles);
          setSelectedProfileId(data.selectedSmartAudioProfileId || data.smartAudioProfiles[0]?.id || '');
        }
      } catch (err) {
        console.error("Failed to fetch profiles", err);
      }
    };
    fetchProfiles();

    // Poll every 5 seconds to get live updates for background tasks
    const interval = setInterval(fetchStatus, 5000);
    return () => clearInterval(interval);
  }, [bookId]);

  useEffect(() => {
    let cancelled = false;
    void fetch(`/api/documents/${encodeURIComponent(bookId)}/settings`, { cache: 'no-store' })
      .then(async (response) => response.ok ? response.json() : null)
      .then((body) => {
        if (cancelled) return;
        const map = body?.settings?.smartAudioCharacters as SmartAudioCharacterMap | undefined;
        if (!map?.entries) {
          setVoiceCharacters({});
          setCastCharacters([]);
          return;
        }
        const labels: Record<string, string[]> = {};
        const choices: Array<{ name: string; voiceId: string }> = [];
        for (const entry of Object.values(map.entries)) {
          const primary = entry.aliasFor ? map.entries[entry.aliasFor] : entry;
          if (!primary?.voiceId) continue;
          labels[primary.voiceId] = Array.from(new Set([
            ...(labels[primary.voiceId] || []),
            entry.name,
          ]));
          if (!entry.aliasFor) choices.push({ name: entry.name, voiceId: primary.voiceId });
        }
        setVoiceCharacters(labels);
        setCastCharacters(choices);
      })
      .catch(() => {
        if (!cancelled) {
          setVoiceCharacters({});
          setCastCharacters([]);
        }
      });
    return () => { cancelled = true; };
  }, [bookId]);

  useEffect(() => {
    if (chapters.length > 0) {
      // Reset edit state when navigating to a new chapter
      setHasEditedText(false);
      fetchChapterText(currentChapterIndex);
    }
  }, [currentChapterIndex]); // Removed 'chapters' from dependencies to prevent text wipe

  // Poll for text updates if we haven't manually edited
  useEffect(() => {
    if (hasEditedText || chapters.length === 0) return;
    const interval = setInterval(() => {
      fetchChapterText(currentChapterIndex, true);
    }, 5000);
    return () => clearInterval(interval);
  }, [hasEditedText, chapters.length, currentChapterIndex]);

  const fetchChapterText = async (index: number, isBackgroundPoll = false) => {
    if (!isBackgroundPoll) setIsTextLoading(true);
    try {
      const [resText, resOrig] = await Promise.all([
        fetch(`/api/audiobook/text?bookId=${bookId}&chapterIndex=${index}&t=${Date.now()}`, { cache: 'no-store' }),
        fetch(`/api/audiobook/text?bookId=${bookId}&chapterIndex=${index}&type=original&t=${Date.now()}`, { cache: 'no-store' })
      ]);
      
      if (resOrig.ok) {
        const origText = await resOrig.text();
        setOriginalText((prev) => (prev !== origText ? origText : prev));
      } else if (!isBackgroundPoll) {
        setOriginalText("");
      }

      if (resText.ok) {
        const text = await resText.text();
        setChapterText((prev) => (prev !== text ? text : prev));
      } else if (!isBackgroundPoll) {
        setChapterText("No text available for this chapter.");
      }
    } catch (err) {
      console.error(err);
      if (!isBackgroundPoll) {
        setChapterText("Failed to load text.");
        setOriginalText("");
      }
    } finally {
      if (!isBackgroundPoll) setIsTextLoading(false);
    }
  };

  const handleFixAbbreviations = () => {
    let pt = chapterText;
    const profile = smartAudioProfiles.find(p => p.id === selectedProfileId) || smartAudioProfiles[0];
    
    // Combine base books and custom profile books
    const booksMap: Record<string, string> = {};
    BASE_BOOKS.forEach(b => booksMap[b.key] = b.value);
    if (profile?.books) {
      Object.entries(profile.books).forEach(([k, v]) => booksMap[k] = v as string);
    }
    
    // 1. Expand books
    Object.entries(booksMap).forEach(([short, full]) => {
      const escapedShort = short.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(`\\b${escapedShort}\\.?\\s+(\\d+):(\\d+)(?:[-–](\\d+))?`, 'g');
      pt = pt.replace(regex, (match, chap, vStart, vEnd) => {
        if (vEnd) return `${full} chapter ${chap} verse ${vStart} through ${vEnd}`;
        return `${full} chapter ${chap} verse ${vStart}`;
      });
    });

    // 2. vv. and v.
    pt = pt.replace(/\bvv\.\s*(\d+)/g, 'verses $1');
    pt = pt.replace(/\bv\.\s*(\d+)/g, 'verse $1');

    // 3. User abbreviations
    if (profile?.abbreviations) {
      const keys = Object.keys(profile.abbreviations).sort((a, b) => b.length - a.length);
      keys.forEach(key => {
        const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`(?<!\\w)${escapedKey}(?!\\w)`, 'g');
        pt = pt.replace(regex, profile.abbreviations[key]);
      });
    }

    setChapterText(pt);
    setHasEditedText(true);
    toast.success("Abbreviations expanded successfully!");
  };

  const handleRegenerate = async (textOverride?: string) => {
    const textToRecord = textOverride || chapterText;
    if (!textToRecord) return;
    setIsRegenerating(true);
    const currentChapter = chapters[currentChapterIndex];
    try {
      const res = await fetch(`/api/audiobook/chapter`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          bookId,
          documentId: bookId,
          chapterIndex: currentChapterIndex,
          chapterTitle: currentChapter.title,
          text: textToRecord,
          useSmartAudio: false,
          format: currentChapter.format,
        }),
      });

      if (!res.ok) {
        throw new Error("Failed to regenerate audio");
      }
      
      toast.success("Successfully queued regeneration");
    } catch (error: any) {
      console.error(error);
      toast.error(error.message || "Failed to trigger regeneration");
    } finally {
      setIsRegenerating(false);
    }
  };

  const updateSpeakerAssignment = (segmentIndex: number, characterName: string) => {
    const choice = castCharacters.find((character) => character.name === characterName);
    if (!choice) return;
    try {
      const parsed = parseVoiceTaggedText(chapterText, { includeOmitted: true });
      if (!parsed[segmentIndex]) return;
      parsed[segmentIndex] = {
        ...parsed[segmentIndex],
        speaker: characterName,
        voiceId: choice.voiceId,
      };
      setChapterText(renderVoiceSegments(parsed));
      setHasEditedText(true);
    } catch {
      toast.error('This chunk has invalid speaker markup and cannot be reassigned safely.');
    }
  };

  const updateSpeakerText = (segmentIndex: number, text: string) => {
    try {
      const parsed = parseVoiceTaggedText(chapterText, { includeOmitted: true });
      if (!parsed[segmentIndex] || !text.trim()) return;
      parsed[segmentIndex] = { ...parsed[segmentIndex], text: text.trim() };
      setChapterText(renderVoiceSegments(parsed));
      setHasEditedText(true);
    } catch {
      toast.error('This chunk has invalid speaker markup and cannot be edited safely.');
    }
  };

  const rerecordSpeakerSegment = (segmentIndex: number) => {
    try {
      const parsed = parseVoiceTaggedText(chapterText, { includeOmitted: true });
      const nextText = speakerTextDrafts[segmentIndex]?.trim();
      if (!parsed[segmentIndex] || !nextText) return;
      parsed[segmentIndex] = { ...parsed[segmentIndex], text: nextText };
      const updatedChapterText = renderVoiceSegments(parsed);
      setChapterText(updatedChapterText);
      setHasEditedText(true);
      void handleRegenerate(updatedChapterText);
    } catch {
      toast.error('This chunk has invalid speaker markup and cannot be re-recorded safely.');
    }
  };

  const restoreOmittedSegment = (segmentIndex: number) => {
    try {
      const parsed = parseVoiceTaggedText(chapterText, { includeOmitted: true });
      if (!parsed[segmentIndex]) return;
      parsed[segmentIndex] = { ...parsed[segmentIndex], omitted: false };
      setChapterText(renderVoiceSegments(parsed));
      setHasEditedText(true);
    } catch {
      toast.error('This removed segment could not be restored safely.');
    }
  };

  const previewSpeakerSegment = async (segmentIndex: number) => {
    const segment = speakerSegments[segmentIndex];
    if (!segment || segment.omitted) return;
    setPlayingSpeakerSegment(segmentIndex);
    try {
      const response = await fetch('/api/tts/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: segment.text.slice(0, 500), voice: segment.voiceId }),
      });
      if (!response.ok) throw new Error('Speaker preview failed.');
      const url = URL.createObjectURL(await response.blob());
      const audio = new Audio(url);
      previewAudioRef.current = audio;
      const finish = () => {
        URL.revokeObjectURL(url);
        setPlayingSpeakerSegment(null);
        if (previewAudioRef.current === audio) previewAudioRef.current = null;
      };
      audio.onended = finish;
      audio.onerror = finish;
      await audio.play();
    } catch (error) {
      setPlayingSpeakerSegment(null);
      toast.error(error instanceof Error ? error.message : 'Speaker preview failed.');
    }
  };

  const activeSpeakerAtPlaybackTime = (currentTime: number, duration: number) => {
    const audible = speakerSegments
      .map((segment, index) => ({ segment, index }))
      .filter(({ segment }) => !segment.omitted);
    const audibleIndex = estimateSpeakerSegmentAtTime(
      audible.map(({ segment }) => segment.text),
      currentTime,
      duration,
    );
    return audibleIndex === null ? null : audible[audibleIndex]?.index ?? null;
  };

  const handleRebuildAllModified = async () => {
    setIsRebuildingAll(true);
    try {
      const res = await fetch('/api/audiobooks/batch-regenerate', { 
        method: 'POST', 
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookId: bookId, dryRun: true }) 
      });
      if (res.ok) {
        const data = await res.json();
        if (data.needsRegeneration && data.needsRegeneration.length > 0) {
           const startRes = await fetch('/api/audiobooks/batch-regenerate', { 
             method: 'POST', 
             headers: { 'Content-Type': 'application/json' },
             body: JSON.stringify({ bookId: bookId }) 
           });
           if (startRes.ok) {
             toast.success('Background rebuild started for modified chunks!');
           } else {
             const err = await startRes.json().catch(() => ({}));
             toast.error(err.error || 'Failed to start rebuild');
           }
        } else {
           toast.success('No modified chunks found! Everything is up to date.');
        }
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || 'Failed to scan');
      }
    } catch (e: any) {
      toast.error(e.message || 'Error scanning books');
    } finally {
      setIsRebuildingAll(false);
    }
  };

  const handleForceRebuildAll = async () => {
    if (!window.confirm("Are you sure you want to re-record every single chunk? This will replace all existing audio for this book!")) {
      return;
    }
    setIsRebuildingAll(true);
    try {
      const startRes = await fetch('/api/audiobooks/batch-regenerate', {
         method: 'POST',
         headers: { 'Content-Type': 'application/json' },
         body: JSON.stringify({ bookId: bookId, forceAll: true })
      });
      if (startRes.ok) {
         toast.success('Background force rebuild started for all chunks!');
      } else {
         const err = await startRes.json().catch(() => ({}));
         toast.error(err.error || 'Failed to start force rebuild');
      }
    } catch (e: any) {
      toast.error(e.message || 'Error starting force rebuild');
    } finally {
      setIsRebuildingAll(false);
    }
  };

  const handleFixAllAbbreviations = async () => {
    setIsFixingAll(true);
    try {
      const res = await fetch('/api/audiobooks/fix-abbreviations-all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bookId, smartAudioProfileId: selectedProfileId })
      });
      if (res.ok) {
        const data = await res.json();
        toast.success(`Fixed abbreviations in ${data.modifiedCount} chunks!`);
        if (data.modifiedCount > 0) {
          // Refresh current chunk just in case it was modified
          fetchChapterText(currentChapterIndex);
        }
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || 'Failed to fix abbreviations');
      }
    } catch (e: any) {
      toast.error(e.message || 'Error fixing abbreviations');
    } finally {
      setIsFixingAll(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-slate-950 text-slate-200">
        <div>Loading...</div>
      </div>
    );
  }

  if (chapters.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-slate-950 text-slate-200">
        <h1 className="text-2xl font-bold mb-4">No Audiobook Available</h1>
        <button className="px-4 py-2 bg-blue-600 rounded" onClick={() => router.push("/app")}>Return to Dashboard</button>
      </div>
    );
  }

  const currentChapter = chapters[currentChapterIndex];

  return (
    <div className="flex flex-col h-screen bg-surface">
      <div className="flex-none p-4 bg-surface border-b border-line-soft flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-text-strong line-clamp-1">Review: {currentChapter.title}</h1>
          <p className="text-text-soft text-sm">Chapter {currentChapterIndex + 1} of {chapters.length}</p>
        </div>
        <div className="flex gap-2 items-center flex-wrap">
          {/* View Toggles */}
          <div className="flex bg-surface-raised border border-line-soft rounded overflow-hidden">
            <button onClick={() => setShowLeftPane(!showLeftPane)} className={`px-3 py-1.5 text-xs font-medium transition-colors ${showLeftPane ? 'bg-accent text-background' : 'text-foreground hover:bg-surface-sunken'}`}>List</button>
            <button onClick={() => setShowMiddlePane(!showMiddlePane)} className={`px-3 py-1.5 text-xs font-medium border-l border-line-soft transition-colors ${showMiddlePane ? 'bg-accent text-background' : 'text-foreground hover:bg-surface-sunken'}`}>Original</button>
            <button onClick={() => setShowRightPane(!showRightPane)} className={`px-3 py-1.5 text-xs font-medium border-l border-line-soft transition-colors ${showRightPane ? 'bg-accent text-background' : 'text-foreground hover:bg-surface-sunken'}`}>Edit</button>
          </div>

          {isMultiVoice && (
            <button
              onClick={() => setShowMultiVoiceStudio(true)}
              className="hidden md:flex px-4 py-1.5 bg-accent hover:bg-secondary-accent text-background rounded font-medium text-sm gap-2"
            >
              🎬 Open Audio-Drama Studio
            </button>
          )}
          <button
            onClick={() => setShowMobilePlayer(true)}
            className="md:hidden px-4 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-white rounded font-medium text-sm gap-2"
          >
            📱 Mobile Player
          </button>
          <div className="hidden md:flex gap-2 items-center border-l border-line-soft pl-2 ml-1">
            <button
              onClick={handleFixAllAbbreviations}
              disabled={isFixingAll || isRebuildingAll || chapters.length === 0}
              className="px-3 py-1.5 bg-indigo-600/10 hover:bg-indigo-600/20 text-indigo-400 rounded font-medium text-xs disabled:opacity-50 transition-colors"
              title="Apply abbreviation fixes to all chunks in this book"
            >
              {isFixingAll ? "Fixing..." : "Fix All Abbreviations"}
            </button>
            <button 
              onClick={handleRebuildAllModified} 
              disabled={isRebuildingAll || chapters.length === 0}
              className="px-3 py-1.5 bg-accent hover:bg-secondary-accent text-background rounded-md shadow font-bold text-xs disabled:opacity-50 transition-all"
              title="Re-record MP3s for any chunk where the text was modified"
            >
              {isRebuildingAll ? "Scanning..." : "Re-Record All Modified chunks"}
            </button>
            <button
              onClick={handleForceRebuildAll}
              disabled={isRebuildingAll || chapters.length === 0}
              className="px-3 py-1.5 bg-rose-600/10 hover:bg-rose-600/20 text-rose-500 rounded font-medium text-xs disabled:opacity-50 transition-colors"
              title="Force re-record every single chunk (useful if you changed voices)"
            >
              Force Re-Record All
            </button>
          </div>
          <div className="flex gap-1 ml-auto md:ml-2">
            <button
              className="px-3 py-1.5 border border-line-soft rounded text-sm disabled:opacity-50"
              onClick={() => setCurrentChapterIndex(i => i - 1)}
              disabled={currentChapterIndex === 0}
            >
              Prev Chapter
            </button>
            <button
              className="px-3 py-1.5 border border-line-soft rounded text-sm disabled:opacity-50"
              onClick={() => setCurrentChapterIndex(i => i + 1)}
              disabled={currentChapterIndex === chapters.length - 1}
            >
              Next Chapter
            </button>
          </div>
        </div>
      </div>

      {/* Global Actions Toolbar */}
      <div className="flex-none p-2 bg-surface border-b border-line-soft flex items-center justify-between flex-wrap gap-2 shadow-sm relative z-10">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs font-semibold text-text-soft tracking-wider mr-2 uppercase">Chunk {currentChapterIndex + 1} Actions:</span>
          
          <button
            onClick={() => setIsPronunciationModalOpen(true)}
            className="bg-surface-raised border border-line-soft hover:bg-surface-sunken text-text-strong px-3 py-1.5 rounded text-xs font-medium shrink-0"
            title="Double-click a word in the text to highlight it, then click here to instantly find and fix its pronunciation"
          >
            Dictionary 🔍
          </button>

          <button
            onClick={() => {
              setNewAbbrevKey('');
              setNewAbbrevVal('');
              setIsQuickAbbrevModalOpen(true);
            }}
            className="bg-surface-raised border border-line-soft hover:bg-surface-sunken text-text-strong px-3 py-1.5 rounded text-xs font-medium shrink-0"
            title="Quickly add a word replacement or abbreviation"
          >
            Abbreviations ✏️
          </button>
          
          <button
            onClick={handleFixAbbreviations}
            className="bg-indigo-600/10 border border-indigo-600/20 hover:bg-indigo-600/20 text-indigo-400 px-3 py-1.5 rounded text-xs font-medium transition-colors"
            title="Instantly expand abbreviations without AI"
          >
            Fix Abbreviations
          </button>

          {smartAudioProfiles.length > 0 && (
            <div className="flex items-center gap-1 border-l border-line-soft pl-2 ml-1">
              <select 
                className="bg-surface text-text-strong border border-line-soft rounded px-2 py-1.5 text-xs font-medium outline-none"
                value={selectedProfileId}
                onChange={(e) => setSelectedProfileId(e.target.value)}
                disabled={isRegenerating || isTextLoading}
              >
                {smartAudioProfiles.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
              <button 
                onClick={() => setIsSettingsModalOpen(true)}
                className="p-1.5 text-text-soft hover:text-text-strong hover:bg-surface-raised rounded transition-colors"
                title="Edit AI Profiles in Settings"
              >
                ⚙️
              </button>
            </div>
          )}
          
          <div className="flex items-center gap-2 bg-surface-raised border border-line-soft rounded px-2 py-1 flex-wrap border-l border-line-soft pl-2 ml-1">
            <label className="flex items-center gap-1.5 text-xs text-text-strong font-medium cursor-pointer" title="Check this to send the Edited text on the right instead of the Original text">
              <input 
                type="checkbox" 
                checked={cleanTarget === 'edited'}
                onChange={(e) => setCleanTarget(e.target.checked ? 'edited' : 'original')}
                className="rounded border-line-soft text-brand-500 focus:ring-brand-500 cursor-pointer"
              />
              Clean Edited
            </label>
            <button
              onClick={() => {
                const textToSend = cleanTarget === 'edited' ? chapterText : (originalText || chapterText);
                if (!textToSend) return;
                setIsRegenerating(true);
                fetch(`/api/audiobook/chapter`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    bookId,
                    documentId: bookId,
                    chapterIndex: currentChapterIndex,
                    chapterTitle: chapters[currentChapterIndex]?.title,
                    text: textToSend,
                    useSmartAudio: true,
                    settings: { smartAudioProfileId: selectedProfileId, scholarAutoScan: true },
                    format: chapters[currentChapterIndex]?.format,
                  }),
              }).then(async res => {
                if (!res.ok) {
                  const txt = await res.text().catch(() => '');
                  console.error("API error text:", txt);
                  throw new Error(`Failed to queue AI cleanup: ${res.status} ${txt.substring(0, 100)}`);
                }
                toast.success("Queued for AI Cleanup! (Waiting for worker...)");
              }).catch(err => {
                console.error(err);
                toast.error(err.message || "Failed to trigger AI cleanup");
              }).finally(() => setIsRegenerating(false));
            }}
            disabled={isRegenerating || isTextLoading}
            className="bg-indigo-600 hover:bg-indigo-500 text-white px-3 py-1.5 rounded text-xs font-medium disabled:opacity-50 flex items-center gap-1 shrink-0"
            title="Send this original text back to Gemini to try cleaning it again"
          >
            ✨ Clean with AI
          </button>
          </div>
        </div>
        
        <button 
            onClick={() => void handleRegenerate()}
          disabled={isRegenerating || isTextLoading}
          className="bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-1.5 rounded text-xs font-medium disabled:opacity-50 shrink-0"
        >
          {isRegenerating ? "Rebuilding..." : "Save to Audiobook"}
        </button>
      </div>

      <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
        {/* Far Left side: Chapter List / Guesses */}
        {showLeftPane && (
          <div className={`w-full ${isMultiVoice ? 'md:w-1/2' : 'md:w-1/4'} flex flex-col border-r border-line-soft bg-surface h-1/3 md:h-full`}>
            <div className="p-4 border-b border-line-soft font-semibold text-text-strong bg-surface-raised shrink-0">
              {isMultiVoice ? 'Chapters & Speakers' : 'Context / Chapter Guesses'}
            </div>
            <div className="flex-1 overflow-y-auto p-2">
              {chapters.map((chap, idx) => {
                const selected = idx === currentChapterIndex;
                return (
                  <div key={chap.index} className="mb-1">
                    <button
                      onClick={() => setCurrentChapterIndex(idx)}
                      className={`w-full text-left p-3 rounded text-sm transition-colors ${
                        selected
                          ? "bg-brand-500/20 text-brand-400 border border-brand-500/30"
                          : "text-text-soft hover:bg-surface-raised border border-transparent"
                      }`}
                    >
                      <div className="flex justify-between items-start gap-2">
                        <div className="font-medium">Chunk {chap.index + 1}</div>
                        {/* @ts-ignore */}
                        {chap.isEmptyText && (
                          <span className="text-red-500 shrink-0 text-base" title="Warning: AI returned empty text for this chunk!">
                            ⚠️
                          </span>
                        )}
                      </div>
                      <div className="text-xs mt-1 line-clamp-2 opacity-80">{chap.title}</div>
                    </button>
                    {selected && isMultiVoice && (
                      <div className="ml-3 border-l border-brand-500/30 py-1 pl-2" aria-label="Speaker segments for selected chapter">
                        {speakerSegments.length > 0 ? speakerSegments.map((segment, segmentIndex) => (
                          <div
                            key={segment.id}
                            id={`drama-speaker-row-${segmentIndex}`}
                            className={`mb-2 grid w-full grid-cols-1 gap-2 rounded border p-2 text-left lg:grid-cols-[2.5rem_minmax(9rem,0.7fr)_minmax(14rem,1.5fr)_auto] lg:items-start ${
                              segment.omitted
                                ? 'border-line bg-transparent outline outline-1 outline-dashed outline-line'
                                : activeSpeakerSegment === segmentIndex
                                ? 'border-accent bg-accent-wash shadow-sm'
                                : 'border-line-soft bg-surface-raised'
                            }`}
                          >
                            <div className={`text-xs font-bold ${activeSpeakerSegment === segmentIndex ? 'text-accent' : 'text-text-soft'}`}>
                              #{segmentIndex + 1}
                              {segment.omitted && <span className="mt-1 block text-[9px] uppercase text-text-soft">Removed from audio</span>}
                              {activeSpeakerSegment === segmentIndex && <span className="mt-1 block text-[9px] uppercase">Now playing</span>}
                            </div>
                            <div>
                              <label className="block text-[10px] font-semibold uppercase tracking-wide text-text-soft">Character</label>
                              <select
                                value={castCharacters.find((character) => character.voiceId === segment.voiceId)?.name || ''}
                                onChange={(event) => updateSpeakerAssignment(segmentIndex, event.target.value)}
                                className={`mt-1 w-full rounded border bg-surface px-2 py-1 text-xs font-semibold text-text-strong ${activeSpeakerSegment === segmentIndex ? 'border-accent ring-1 ring-accent' : 'border-line-soft'}`}
                                aria-label={`Speaker for segment ${segmentIndex + 1}`}
                              >
                                {!castCharacters.some((character) => character.voiceId === segment.voiceId) && (
                                  <option value="">{segment.speaker} — {segment.voiceId}</option>
                                )}
                                {castCharacters.map((character) => (
                                  <option key={character.name} value={character.name}>
                                    {character.name} — {character.voiceId}
                                  </option>
                                ))}
                              </select>
                            </div>
                            <div>
                              <label className="block text-[10px] font-semibold uppercase tracking-wide text-text-soft">Text</label>
                              <textarea
                                value={speakerTextDrafts[segmentIndex] ?? segment.text}
                                onChange={(event) => setSpeakerTextDrafts((current) => ({
                                  ...current,
                                  [segmentIndex]: event.target.value,
                                }))}
                                onBlur={(event) => updateSpeakerText(segmentIndex, event.target.value)}
                                className="mt-1 min-h-20 w-full rounded border border-line-soft bg-surface p-2 text-xs leading-relaxed text-text-strong"
                                aria-label={`Text for speaker segment ${segmentIndex + 1}`}
                              />
                            </div>
                            <div className="flex gap-1 lg:flex-col">
                              <button
                                type="button"
                                onClick={() => void previewSpeakerSegment(segmentIndex)}
                                disabled={segment.omitted || playingSpeakerSegment === segmentIndex}
                                className="rounded border border-line-soft px-2 py-1 text-xs text-text-strong disabled:opacity-50"
                              >
                                {segment.omitted ? 'No audio' : playingSpeakerSegment === segmentIndex ? 'Playing…' : '▶ Audio'}
                              </button>
                              {segment.omitted ? (
                                <button
                                  type="button"
                                  onClick={() => restoreOmittedSegment(segmentIndex)}
                                  className="rounded border border-accent px-2 py-1 text-xs font-semibold text-accent"
                                >
                                  Restore
                                </button>
                              ) : <button
                                type="button"
                                onClick={() => rerecordSpeakerSegment(segmentIndex)}
                                disabled={isRegenerating}
                                className="rounded bg-accent px-2 py-1 text-xs font-semibold text-background disabled:opacity-50"
                                title="Re-record this corrected turn and rebuild the containing audio chunk"
                              >
                                {isRegenerating ? 'Recording…' : 'Re-record'}
                              </button>}
                            </div>
                          </div>
                        )) : (
                          <p className="p-2 text-[11px] text-text-soft">No valid speaker segments were found in this chunk.</p>
                        )}
                        {speakerSegments.length > 0 && (
                          <button
                            type="button"
                            onClick={() => void handleRegenerate()}
                            disabled={!hasEditedText || isRegenerating}
                            className="mt-1 w-full rounded bg-accent px-2 py-1.5 text-xs font-semibold text-background disabled:opacity-50"
                          >
                            {isRegenerating ? 'Re-recording…' : `Apply Changes & Re-record Chunk ${chap.index + 1}`}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Middle: HTML Viewer with highlighting */}
        {showMiddlePane && (
          <div className="flex-1 overflow-hidden relative flex flex-col border-r border-line-soft h-1/3 md:h-full">
          <div className="p-4 shrink-0 border-b border-line-soft bg-surface flex justify-between items-center">
            <span className="font-semibold text-text-strong">Original Text (Pre-Cleanup)</span>
          </div>
          <div className="flex-1 relative overflow-y-auto">
            {isTextLoading ? (
              <div className="absolute inset-0 flex items-center justify-center">Loading text...</div>
            ) : (
              <div className="absolute inset-0 px-4">
                <HTMLViewer
                  blocks={blocks}
                  isTxt={true}
                  isLoading={false}
                />
              </div>
            )}
          </div>
          </div>
        )}

        {/* Right side: Editor */}
        {showRightPane && (
          <div className="w-full md:w-1/3 flex flex-col bg-surface-raised border-l border-line-soft h-1/3 md:h-full">
            <div className="p-4 border-b border-line-soft flex justify-between items-center bg-surface shrink-0">
              <h2 className="font-semibold text-text-strong truncate pr-2" title="Edit text (after Smart AI Processing)">
                Edit text (after Smart AI Processing)
              </h2>
            </div>
            <div className="flex-1 p-4 overflow-hidden relative">
              <textarea
                value={chapterText}
                onChange={(e) => {
                  setHasEditedText(true);
                  setChapterText(e.target.value);
                }}
                onSelect={(e) => {
                  const target = e.target as HTMLTextAreaElement;
                  const start = target.selectionStart;
                  const end = target.selectionEnd;
                  if (start !== end && start !== undefined) {
                    // Only capture if it's a reasonably sized word (e.g., < 50 chars)
                    const text = target.value.substring(start, end).trim();
                    if (text && text.length < 50) {
                      setSelectedText(text);
                    }
                  }
                }}
                className="absolute inset-4 w-[calc(100%-2rem)] h-[calc(100%-2rem)] bg-surface border border-line-soft rounded-lg text-text-strong p-4 text-sm font-mono leading-relaxed resize-none focus:outline-none focus:ring-2 focus:ring-primary/50"
                placeholder="Edit the text here..."
              />
            </div>
            <div className="p-4 text-xs text-text-soft bg-surface border-t border-line-soft shrink-0">
              Changes to the text will not be heard until you click "Save to Audiobook" to rebuild the MP3 file.
            </div>
          </div>
        )}
      </div>

      {/* Simple Audio Player for pre-recorded chapter MP3 */}
      <div className="p-4 bg-surface-raised border-t border-line-soft flex items-center justify-center">
        {!isTextLoading && chapterText.length > 0 ? (
          <audio 
            key={`${bookId}-${currentChapterIndex}`}
            controls 
            autoPlay
            onTimeUpdate={(event) => setActiveSpeakerSegment(activeSpeakerAtPlaybackTime(
              event.currentTarget.currentTime,
              event.currentTarget.duration,
            ))}
            onEnded={() => setActiveSpeakerSegment(null)}
            className="w-full max-w-2xl"
            src={`/api/audiobook/chapter?bookId=${bookId}&chapterIndex=${currentChapterIndex}`}
          />
        ) : (
          <div className="text-text-soft text-sm py-3">Loading audio...</div>
        )}
      </div>
      
      <BookPronunciationInspectorModal
        isOpen={isPronunciationModalOpen}
        onClose={() => setIsPronunciationModalOpen(false)}
        initialBookId="" // Use global by default
        initialSearchQuery={selectedText}
        initialUseFuzzySearch={!!selectedText} // Auto-fuzzy search if they selected a word
      />

      <ModalFrame open={isSettingsModalOpen} onClose={() => setIsSettingsModalOpen(false)} size="xl">
        <div className="flex flex-col max-h-[90vh] overflow-hidden bg-surface rounded-xl border border-line-soft">
          <div className="flex justify-between items-center p-4 border-b border-line-soft bg-surface-raised shrink-0">
            <h2 className="text-xl font-bold text-text-strong">AI Settings & Profiles</h2>
            <button onClick={() => setIsSettingsModalOpen(false)} className="text-text-soft hover:text-text-strong text-2xl px-2 leading-none">&times;</button>
          </div>
          <div className="flex-1 overflow-y-auto custom-scrollbar p-2">
            <SmartAudioSettings />
          </div>
        </div>
      </ModalFrame>

      <ModalFrame open={isQuickAbbrevModalOpen} onClose={() => setIsQuickAbbrevModalOpen(false)} size="md">
        <div className="bg-surface rounded-xl border border-line-soft overflow-hidden">
          <div className="flex justify-between items-center p-4 border-b border-line-soft bg-surface-raised">
            <div>
              <h2 className="font-bold text-text-strong">Quick Abbreviation</h2>
              <p className="text-xs text-text-soft mt-1">Replace a word or Roman numeral with plain text.</p>
            </div>
            <button onClick={() => setIsQuickAbbrevModalOpen(false)} className="text-text-soft hover:text-text-strong text-xl px-2">&times;</button>
          </div>
          <div className="p-6 flex flex-col gap-4">
            <div>
              <label className="block text-xs font-semibold text-text-strong mb-1">Text in book (e.g. "II")</label>
              <input 
                type="text" 
                value={newAbbrevKey} 
                onChange={(e) => setNewAbbrevKey(e.target.value)}
                className="w-full p-2 border border-line-soft rounded bg-surface-sunken text-text-strong"
                placeholder="Abbreviation or numeral"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-text-strong mb-1">Spoken text (e.g. "point 2")</label>
              <input 
                type="text" 
                value={newAbbrevVal} 
                onChange={(e) => setNewAbbrevVal(e.target.value)}
                className="w-full p-2 border border-line-soft rounded bg-surface-sunken text-text-strong"
                placeholder="How it should be read"
              />
            </div>
            <button 
              disabled={!newAbbrevKey.trim() || !newAbbrevVal.trim()}
              onClick={async () => {
                if (!newAbbrevKey.trim() || !newAbbrevVal.trim()) return;
                try {
                  const updatedProfiles = smartAudioProfiles.map(p => {
                    if (p.id === selectedProfileId) {
                      return {
                        ...p,
                        abbreviations: {
                          ...(p.abbreviations || {}),
                          [newAbbrevKey.trim()]: newAbbrevVal.trim()
                        }
                      };
                    }
                    return p;
                  });
                  
                  const response = await fetch('/api/tts-settings', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      smartAudioProfiles: updatedProfiles,
                      selectedSmartAudioProfileId: selectedProfileId
                    }),
                  });
                  if (!response.ok) throw new Error('Failed to save abbreviation');
                  const saved = await response.json();
                  setSmartAudioProfiles(Array.isArray(saved.smartAudioProfiles) ? saved.smartAudioProfiles : updatedProfiles);
                  toast.success(`Added abbreviation: ${newAbbrevKey} -> ${newAbbrevVal}`);
                  setIsQuickAbbrevModalOpen(false);
                  setNewAbbrevKey('');
                  setNewAbbrevVal('');
                  
                  // Auto-apply to current text so they see it instantly!
                  setTimeout(() => {
                    handleFixAbbreviations();
                  }, 100);
                } catch (e: any) {
                  toast.error(e.message || 'Failed to save abbreviation');
                }
              }}
              className="mt-2 w-full py-2 bg-accent hover:bg-secondary-accent text-background rounded font-semibold transition-colors disabled:opacity-50"
            >
              Save Abbreviation
            </button>
          </div>
        </div>
      </ModalFrame>

      {/* Multi-Voice Studio Overlay */}
      {showMultiVoiceStudio && isMultiVoice && (
        <MultiVoiceReviewStudio
          bookId={bookId}
          chapterIndex={currentChapterIndex}
          initialText={chapterText}
          onClose={() => setShowMultiVoiceStudio(false)}
          onRebuildAllModified={handleRebuildAllModified}
          isRebuildingAll={isRebuildingAll}
          onSaveAndRegenerate={async (newXml) => {
            setChapterText(newXml);
            // Trigger the regenerate logic with newXml
            setIsRegenerating(true);
            try {
              const res = await fetch(`/api/audiobook/chapter`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  bookId,
                  documentId: bookId,
                  chapterIndex: currentChapterIndex,
                  chapterTitle: currentChapter.title,
                  text: newXml,
                  useSmartAudio: false,
                  format: currentChapter.format,
                }),
              });
              if (!res.ok) throw new Error("Failed to regenerate audio");
              toast.success("Successfully rebuilt background audiobook chapter!");
              setShowMultiVoiceStudio(false);
            } catch (err) {
              console.error(err);
              toast.error("Error regenerating audio.");
              throw err;
            } finally {
              setIsRegenerating(false);
            }
          }}
        />
      )}

      {/* Mobile Player Overlay */}
      {showMobilePlayer && (
        <MobileReviewPlayer
          bookId={bookId}
          chapterIndex={currentChapterIndex}
          chapterTitle={currentChapter.title}
          audioUrl={`/api/audiobook/chapter?bookId=${bookId}&chapterIndex=${currentChapterIndex}`}
          onFlagError={async (timeMs) => {
            const response = await fetch('/api/audiobook/review-flags', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                documentId: bookId,
                chapterIndex: currentChapterIndex,
                timestampMs: timeMs,
              }),
            });
            if (!response.ok) {
              const body = await response.json().catch(() => ({})) as { error?: string };
              throw new Error(body.error || 'Failed to save review flag.');
            }
          }}
          onNextChapter={() => setCurrentChapterIndex(i => Math.min(chapters.length - 1, i + 1))}
          onPrevChapter={() => setCurrentChapterIndex(i => Math.max(0, i - 1))}
          onExit={() => setShowMobilePlayer(false)}
        />
      )}
    </div>
  );
}
