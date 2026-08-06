import React, { useState, useEffect } from 'react';
import { Dialog } from '@headlessui/react';
import type { SmartAudioCharacterMap } from '@/types/document-settings';


interface MultiVoiceCharacterModalProps {
  documentId: string;
  isOpen: boolean;
  onClose: () => void;
  onSave: (characterMap: SmartAudioCharacterMap) => Promise<void>;
  initialCharacterMap?: SmartAudioCharacterMap;
}

export function MultiVoiceCharacterModal({
  documentId,
  isOpen,
  onClose,
  onSave,
  initialCharacterMap
}: MultiVoiceCharacterModalProps) {
  const voices = ['af_heart', 'af_alloy', 'af_aoede', 'af_bella', 'af_jessica', 'af_kore', 'af_nicole', 'af_nova', 'af_river', 'af_sarah', 'af_sky', 'am_adam', 'am_echo', 'am_eric', 'am_fenrir', 'am_liam', 'am_michael', 'am_onyx', 'am_puck', 'am_santa'];

  const [characterMap, setCharacterMap] = useState<SmartAudioCharacterMap | null>(initialCharacterMap || null);
  const [isPlaying, setIsPlaying] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen && initialCharacterMap) {
      setCharacterMap(JSON.parse(JSON.stringify(initialCharacterMap)));
    }
  }, [isOpen, initialCharacterMap]);

  if (!isOpen || !characterMap) return null;

  const entries = Object.values(characterMap.entries);
  const primaryCharacters = entries.filter(e => !e.aliasFor);

  const handleVoiceChange = (name: string, voiceId: string) => {
    setCharacterMap(prev => {
      if (!prev) return prev;
      const next = { ...prev };
      next.entries[name].voiceId = voiceId;
      return next;
    });
  };

  const handleAliasChange = (name: string, aliasFor: string) => {
    setCharacterMap(prev => {
      if (!prev) return prev;
      const next = { ...prev };
      next.entries[name].aliasFor = aliasFor === 'none' ? null : aliasFor;
      next.entries[name].voiceId = null; // Clear voice if they are now an alias
      return next;
    });
  };

  const handlePreview = async (name: string) => {
    const entry = characterMap.entries[name];
    if (!entry || !entry.voiceId || !entry.sampleText) return;
    
    setIsPlaying(name);
    try {
      const res = await fetch('/api/tts/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: entry.sampleText, voice: entry.voiceId })
      });
      if (res.ok) {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        audio.onended = () => setIsPlaying(null);
        await audio.play();
      }
    } catch (e) {
      console.error(e);
      setIsPlaying(null);
    }
  };

  const handleSave = async () => {
    await onSave(characterMap);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        
        {/* Header */}
        <div className="p-6 border-b border-zinc-800 flex justify-between items-center bg-zinc-900/50">
          <div>
            <h2 className="text-2xl font-bold text-white bg-clip-text text-transparent bg-gradient-to-r from-indigo-400 to-purple-400">
              Audio-Drama Casting
            </h2>
            <p className="text-zinc-400 text-sm mt-1">Map your extracted characters to Kokoro voices.</p>
          </div>
          <button onClick={onClose} className="p-2 text-zinc-400 hover:text-white rounded-full hover:bg-zinc-800 transition-colors">
            ✕
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4 bg-zinc-950/50">
          {entries.map((char) => (
            <div key={char.name} className="flex flex-col gap-3 p-4 bg-zinc-900 border border-zinc-800 rounded-xl hover:border-indigo-500/30 transition-colors">
              <div className="flex justify-between items-start gap-4">
                
                {/* Character Info */}
                <div className="flex-1">
                  <div className="flex items-center gap-3">
                    <h3 className="text-lg font-semibold text-zinc-100">{char.name}</h3>
                    {char.aliasFor && (
                      <span className="px-2 py-0.5 rounded-full bg-zinc-800 text-xs font-medium text-zinc-400 border border-zinc-700">
                        Alias for {char.aliasFor}
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-zinc-400 mt-1">{char.description}</p>
                </div>

                {/* Controls */}
                <div className="flex items-center gap-3 w-72 shrink-0">
                  <div className="flex flex-col gap-2 w-full">
                    {/* Alias Dropdown */}
                    <select 
                      className="w-full bg-zinc-950 border border-zinc-800 text-sm rounded-lg p-2 text-zinc-300 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all"
                      value={char.aliasFor || 'none'}
                      onChange={(e) => handleAliasChange(char.name, e.target.value)}
                    >
                      <option value="none">Primary Character</option>
                      {primaryCharacters.filter(p => p.name !== char.name).map(p => (
                        <option key={p.name} value={p.name}>Alias for {p.name}</option>
                      ))}
                    </select>

                    {/* Voice Dropdown */}
                    {!char.aliasFor && (
                      <div className="flex gap-2">
                        <select 
                          className="flex-1 bg-zinc-950 border border-zinc-800 text-sm rounded-lg p-2 text-zinc-300 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all"
                          value={char.voiceId || ''}
                          onChange={(e) => handleVoiceChange(char.name, e.target.value)}
                        >
                          <option value="" disabled>Select a Voice</option>
                          {voices?.map(v => (
                            <option key={v} value={v}>{v}</option>
                          ))}
                        </select>
                        <button 
                          onClick={() => handlePreview(char.name)}
                          disabled={!char.voiceId || isPlaying === char.name}
                          className="p-2 bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 rounded-lg hover:bg-indigo-500/20 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center shrink-0"
                          title="Preview voice"
                        >
                          {isPlaying === char.name ? '⏸' : '▶'}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Sample Quote */}
              <div className="mt-2 text-sm text-zinc-500 italic bg-zinc-950/50 p-3 rounded-lg border border-zinc-800/50">
                "{char.sampleText}"
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-zinc-800 bg-zinc-900/50 flex justify-end gap-3">
          <button 
            onClick={onClose}
            className="px-5 py-2.5 text-sm font-medium text-zinc-300 hover:text-white bg-zinc-800 hover:bg-zinc-700 rounded-lg transition-colors border border-transparent"
          >
            Cancel
          </button>
          <button 
            onClick={handleSave}
            className="px-5 py-2.5 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-500 rounded-lg transition-all shadow-lg shadow-indigo-500/20 border border-indigo-500/50"
          >
            Save & Continue Generation
          </button>
        </div>
      </div>
    </div>
  );
}
