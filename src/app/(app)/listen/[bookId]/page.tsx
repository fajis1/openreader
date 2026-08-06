"use client";

import { useState, useEffect, useRef, use, useMemo } from "react";
import { useRouter } from "next/navigation";
import { HTMLViewer } from "@/components/views/HTMLViewer";
import { parseHtmlBlocks } from "@/lib/client/html/blocks";
import { BookPronunciationInspectorModal } from "@/components/doclist/BookPronunciationInspectorModal";
import { MultiVoiceReviewStudio } from "@/components/audiobooks/MultiVoiceReviewStudio";
import { MobileReviewPlayer } from "@/components/audiobooks/MobileReviewPlayer";

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
  
  const [chapterText, setChapterText] = useState("");
  const [isTextLoading, setIsTextLoading] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [isPronunciationModalOpen, setIsPronunciationModalOpen] = useState(false);
  const [selectedText, setSelectedText] = useState("");
  
  const [showMultiVoiceStudio, setShowMultiVoiceStudio] = useState(false);
  const [showMobilePlayer, setShowMobilePlayer] = useState(false);

  const isMultiVoice = chapterText.includes('<voice');

  const blocks = useMemo(() => {
    if (!chapterText) return [];
    return parseHtmlBlocks(chapterText, true); // true for isTxt
  }, [chapterText]);

  useEffect(() => {
    async function fetchStatus() {
      try {
        const res = await fetch(`/api/audiobook/status?bookId=${bookId}`);
        const data = await res.json();
        if (data.chapters && data.chapters.length > 0) {
          setChapters(data.chapters);
        } else {
          setChapters([]);
        }
      } catch (err) {
        console.error("Failed to fetch audiobook status", err);
      } finally {
        setLoading(false);
      }
    }
    fetchStatus();
  }, [bookId]);

  useEffect(() => {
    if (chapters.length > 0) {
      fetchChapterText(currentChapterIndex);
    }
  }, [currentChapterIndex, chapters]);

  const fetchChapterText = async (index: number) => {
    setIsTextLoading(true);
    try {
      const res = await fetch(`/api/audiobook/text?bookId=${bookId}&chapterIndex=${index}`);
      if (res.ok) {
        const text = await res.text();
        setChapterText(text);
      } else {
        setChapterText("No text available for this chapter.");
      }
    } catch (err) {
      console.error(err);
      setChapterText("Failed to load text.");
    } finally {
      setIsTextLoading(false);
    }
  };

  const handleRegenerate = async () => {
    if (!chapterText) return;
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
          text: chapterText,
          useSmartAudio: false,
          format: currentChapter.format,
        }),
      });

      if (!res.ok) {
        throw new Error("Failed to regenerate audio");
      }
      
      alert("Successfully rebuilt background audiobook chapter!");
    } catch (err) {
      console.error(err);
      alert("Error regenerating audio.");
    } finally {
      setIsRegenerating(false);
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
        <div className="flex gap-2 items-center">
          {isMultiVoice && (
            <button
              onClick={() => setShowMultiVoiceStudio(true)}
              className="hidden md:flex px-4 py-1.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded font-medium text-sm gap-2"
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
          <button
            className="px-3 py-1.5 border border-line-soft rounded text-sm disabled:opacity-50 ml-2"
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

      <div className="flex-1 flex flex-col md:flex-row overflow-hidden">
        {/* Far Left side: Chapter List / Guesses */}
        <div className="w-full md:w-1/4 flex flex-col border-r border-line-soft bg-surface">
          <div className="p-4 border-b border-line-soft font-semibold text-text-strong bg-surface-raised">
            Context / Chapter Guesses
          </div>
          <div className="flex-1 overflow-y-auto p-2">
            {chapters.map((chap, idx) => (
              <button
                key={idx}
                onClick={() => setCurrentChapterIndex(idx)}
                className={`w-full text-left p-3 mb-1 rounded text-sm transition-colors ${
                  idx === currentChapterIndex
                    ? "bg-brand-500/20 text-brand-400 border border-brand-500/30"
                    : "text-text-soft hover:bg-surface-raised border border-transparent"
                }`}
              >
                <div className="font-medium">Chunk {chap.index + 1}</div>
                <div className="text-xs mt-1 line-clamp-2 opacity-80">{chap.title}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Middle: HTML Viewer with highlighting */}
        <div className="flex-1 overflow-hidden relative border-r border-line-soft">
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

        {/* Right side: Editor */}
        <div className="w-full md:w-1/3 flex flex-col bg-surface-raised border-l border-line-soft">
          <div className="p-4 border-b border-line-soft flex justify-between items-center bg-surface">
            <h2 className="font-semibold text-text-strong">Edit Text</h2>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setIsPronunciationModalOpen(true)}
                className="bg-surface-raised border border-line-soft hover:bg-surface-sunken text-text-strong px-3 py-1.5 rounded text-sm font-medium"
                title="Open Global Dictionary Lookup"
              >
                Dictionary 🔍
              </button>
              <button 
                onClick={handleRegenerate} 
                disabled={isRegenerating || isTextLoading}
                className="bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-1.5 rounded text-sm font-medium disabled:opacity-50"
              >
                {isRegenerating ? "Rebuilding..." : "Save to Audiobook"}
              </button>
            </div>
          </div>
          <div className="flex-1 p-4 overflow-hidden relative">
            <textarea
              value={chapterText}
              onChange={(e) => setChapterText(e.target.value)}
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
          <div className="p-4 text-xs text-text-soft bg-surface border-t border-line-soft">
            Changes to the text will not be heard until you click "Save to Audiobook" to rebuild the MP3 file.
          </div>
        </div>
      </div>

      {/* Simple Audio Player for pre-recorded chapter MP3 */}
      <div className="p-4 bg-surface-raised border-t border-line-soft flex items-center justify-center">
        {!isTextLoading && chapterText.length > 0 ? (
          <audio 
            key={`${bookId}-${currentChapterIndex}`}
            controls 
            autoPlay
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

      {/* Multi-Voice Studio Overlay */}
      {showMultiVoiceStudio && isMultiVoice && (
        <MultiVoiceReviewStudio
          bookId={bookId}
          chapterIndex={currentChapterIndex}
          initialText={chapterText}
          onClose={() => setShowMultiVoiceStudio(false)}
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
              alert("Successfully rebuilt background audiobook chapter!");
            } catch (err) {
              console.error(err);
              alert("Error regenerating audio.");
            } finally {
              setIsRegenerating(false);
              setShowMultiVoiceStudio(false);
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
            console.log("Flagged error for mobile review at ms:", timeMs);
            // Future: Post this to a DB table to render in Desktop Studio
          }}
          onNextChapter={() => setCurrentChapterIndex(i => Math.min(chapters.length - 1, i + 1))}
          onPrevChapter={() => setCurrentChapterIndex(i => Math.max(0, i - 1))}
          onExit={() => setShowMobilePlayer(false)}
        />
      )}
    </div>
  );
}
