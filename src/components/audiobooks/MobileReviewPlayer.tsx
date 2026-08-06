import React, { useState, useRef, useEffect } from 'react';

interface MobileReviewPlayerProps {
  bookId: string;
  chapterIndex: number;
  chapterTitle: string;
  audioUrl: string;
  onFlagError: (timestampMs: number) => Promise<void>;
  onNextChapter: () => void;
  onPrevChapter: () => void;
  onExit: () => void;
}

export function MobileReviewPlayer({
  bookId,
  chapterIndex,
  chapterTitle,
  audioUrl,
  onFlagError,
  onNextChapter,
  onPrevChapter,
  onExit
}: MobileReviewPlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isFlagging, setIsFlagging] = useState(false);
  const [showFlagToast, setShowFlagToast] = useState(false);

  // Restore progress on mount and save on timeupdate
  useEffect(() => {
    const saved = localStorage.getItem(`openreader_audio_progress_${bookId}`);
    if (saved && audioRef.current) {
      try {
        const { savedChapter, savedTime } = JSON.parse(saved);
        if (savedChapter === chapterIndex) {
          audioRef.current.currentTime = savedTime;
          setProgress(savedTime);
        }
      } catch (e) {}
    }
  }, [bookId, chapterIndex, audioUrl]);

  const handleTimeUpdate = () => {
    if (audioRef.current) {
      const currentTime = audioRef.current.currentTime;
      setProgress(currentTime);
      localStorage.setItem(`openreader_audio_progress_${bookId}`, JSON.stringify({
        savedChapter: chapterIndex,
        savedTime: currentTime
      }));
    }
  };

  // Handle Play/Pause
  const togglePlay = () => {
    if (audioRef.current) {
      if (isPlaying) {
        audioRef.current.pause();
      } else {
        audioRef.current.play();
      }
      setIsPlaying(!isPlaying);
    }
  };

  // Rewind 15 seconds
  const handleRewind = () => {
    if (audioRef.current) {
      audioRef.current.currentTime = Math.max(0, audioRef.current.currentTime - 15);
    }
  };

  // Flag Error
  const handleFlag = async () => {
    if (audioRef.current && !isFlagging) {
      setIsFlagging(true);
      const currentTimeMs = Math.floor(audioRef.current.currentTime * 1000);
      
      try {
        await onFlagError(currentTimeMs);
        // Show success toast
        setShowFlagToast(true);
        setTimeout(() => setShowFlagToast(false), 2000);
      } catch (e) {
        console.error("Failed to flag error", e);
      } finally {
        setIsFlagging(false);
      }
    }
  };

  // Format time helper
  const formatTime = (seconds: number) => {
    if (!seconds || isNaN(seconds)) return "00:00";
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div className="fixed inset-0 z-50 bg-zinc-950 flex flex-col text-white pb-safe">
      {/* Toast Notification */}
      {showFlagToast && (
        <div className="absolute top-20 left-1/2 -translate-x-1/2 bg-indigo-600 text-white px-6 py-3 rounded-full shadow-2xl shadow-indigo-500/20 font-medium z-50 animate-in slide-in-from-top-4 fade-in duration-300 flex items-center gap-2">
          <span>🚩</span> Flagged for Desktop Review
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between p-4 bg-zinc-900 border-b border-zinc-800">
        <button onClick={onExit} className="p-2 text-zinc-400 hover:text-white">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
        </button>
        <div className="text-center">
          <p className="text-xs text-indigo-400 font-bold uppercase tracking-widest">Review Mode</p>
          <h2 className="text-sm font-medium text-zinc-300 truncate max-w-[200px]">{chapterTitle}</h2>
        </div>
        <div className="w-10"></div> {/* Spacer for centering */}
      </div>

      {/* Massive Flag Button Area */}
      <div className="flex-1 flex flex-col items-center justify-center p-8 bg-gradient-to-b from-zinc-900 to-zinc-950">
        <button
          onClick={handleFlag}
          disabled={isFlagging}
          className="relative group flex flex-col items-center justify-center w-64 h-64 bg-zinc-900 rounded-full border-[8px] border-zinc-800 hover:border-red-500/50 hover:bg-zinc-800 active:scale-95 transition-all shadow-2xl overflow-hidden"
        >
          <div className="absolute inset-0 bg-red-500/10 opacity-0 group-hover:opacity-100 transition-opacity"></div>
          <span className="text-6xl mb-4 group-hover:scale-110 transition-transform">🚩</span>
          <span className="text-lg font-bold text-zinc-300 group-hover:text-white transition-colors">Flag Error</span>
          <span className="text-xs text-zinc-500 mt-2 font-medium">Wrong Voice or Pronunciation</span>
          
          {isFlagging && (
            <div className="absolute inset-0 bg-zinc-900/80 flex items-center justify-center backdrop-blur-sm rounded-full">
              <span className="text-white font-medium animate-pulse">Saving...</span>
            </div>
          )}
        </button>
      </div>

      {/* Player Controls */}
      <div className="bg-zinc-900 rounded-t-3xl border-t border-zinc-800 p-6 shadow-[0_-10px_40px_rgba(0,0,0,0.5)]">
        
        {/* Progress Bar */}
        <div className="mb-8">
          <input 
            type="range" 
            min="0" 
            max={duration || 100} 
            value={progress}
            onChange={(e) => {
              if (audioRef.current) {
                audioRef.current.currentTime = Number(e.target.value);
                setProgress(Number(e.target.value));
              }
            }}
            className="w-full h-2 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-indigo-500"
          />
          <div className="flex justify-between text-xs text-zinc-500 font-medium mt-2">
            <span>{formatTime(progress)}</span>
            <span>{formatTime(duration)}</span>
          </div>
        </div>

        {/* Buttons */}
        <div className="flex items-center justify-between px-4">
          <button onClick={onPrevChapter} className="p-3 text-zinc-400 hover:text-white transition-colors">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="19 20 9 12 19 4 19 20"/><line x1="5" y1="19" x2="5" y2="5"/></svg>
          </button>
          
          <button onClick={handleRewind} className="p-3 text-zinc-400 hover:text-white transition-colors flex flex-col items-center">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 2v6h6"/><path d="M3 13a9 9 0 1 0 3-7.7L3 8"/></svg>
            <span className="text-[10px] font-bold mt-1">15s</span>
          </button>
          
          <button 
            onClick={togglePlay} 
            className="w-20 h-20 flex items-center justify-center bg-indigo-600 hover:bg-indigo-500 rounded-full text-white shadow-lg shadow-indigo-600/30 transition-transform active:scale-95"
          >
            {isPlaying ? (
              <svg width="32" height="32" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
            ) : (
              <svg width="32" height="32" viewBox="0 0 24 24" fill="currentColor" className="ml-2"><polygon points="5 3 19 12 5 21 5 3"/></svg>
            )}
          </button>
          
          <button onClick={onNextChapter} className="p-3 text-zinc-400 hover:text-white transition-colors">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="5 4 15 12 5 20 5 4"/><line x1="19" y1="5" x2="19" y2="19"/></svg>
          </button>
        </div>
      </div>

      {/* Hidden Audio Element */}
      <audio 
        ref={audioRef}
        src={audioUrl}
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={() => setDuration(audioRef.current?.duration || 0)}
        onEnded={() => {
          setIsPlaying(false);
          onNextChapter();
        }}
        autoPlay
      />
    </div>
  );
}
