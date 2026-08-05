'use client';

import { useState, useEffect } from 'react';
import { ModalFrame } from '@/components/ui';

export function DictionaryUpdateModal() {
  const [isOpen, setIsOpen] = useState(false);
  const [data, setData] = useState<any>(null);
  const [selectedPronunciations, setSelectedPronunciations] = useState<Record<string, string>>({});
  const [selectedDefinitions, setSelectedDefinitions] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetch('/api/tts/dictionary-updates')
      .then(r => r.json())
      .then(res => {
        if (res.hasUpdates) {
          setData(res);
          setIsOpen(true);
          // Pre-select all by default
          const selP: Record<string, string> = {};
          const selD: Record<string, string> = {};
          res.updates.forEach((u: any) => {
            if (u.type === 'pronunciation') selP[u.word] = u.git;
            if (u.type === 'definition') selD[u.word] = u.git;
          });
          setSelectedPronunciations(selP);
          setSelectedDefinitions(selD);
        }
      })
      .catch(e => console.error("Failed to check for dictionary updates", e))
      .finally(() => setIsLoading(false));
  }, []);

  const handleApply = async (dismissAll = false) => {
    try {
      await fetch('/api/tts/dictionary-updates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          hash: data.hash,
          selectedPronunciations,
          selectedDefinitions,
          dismissAll
        })
      });
      setIsOpen(false);
    } catch (e) {
      console.error(e);
      alert('Failed to save preferences.');
    }
  };

  if (!isOpen || !data) return null;

  return (
    <ModalFrame open={isOpen} onClose={() => setIsOpen(false)}>
      <div className="flex flex-col max-h-[80vh] min-w-[600px] max-w-3xl bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100 p-6">
        <h2 className="text-xl font-bold mb-2">
          {data.isAdmin ? 'Global Library Updates Available' : 'New Library Words Available'}
        </h2>
        <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
          {data.isAdmin 
            ? "Your Docker container's Git dictionary has new or conflicting words compared to your current Global Library database. Choose which ones to accept."
            : "The system's dictionary has been updated. You can add these new pronunciations to your personal profile."}
        </p>

        <div className="flex-1 overflow-auto border dark:border-gray-700 rounded mb-4">
          <table className="w-full text-left text-sm">
            <thead className="bg-gray-100 dark:bg-gray-800 sticky top-0">
              <tr>
                <th className="p-2 border-b dark:border-gray-700 w-8"></th>
                <th className="p-2 border-b dark:border-gray-700">Type</th>
                <th className="p-2 border-b dark:border-gray-700">Word</th>
                <th className="p-2 border-b dark:border-gray-700">Git Update</th>
                <th className="p-2 border-b dark:border-gray-700">Current Local</th>
              </tr>
            </thead>
            <tbody>
              {data.updates.map((u: any, i: number) => {
                const isPronunc = u.type === 'pronunciation';
                const isSelected = isPronunc ? !!selectedPronunciations[u.word] : !!selectedDefinitions[u.word];
                
                return (
                  <tr key={i} className="border-b dark:border-gray-700 last:border-0 hover:bg-gray-50 dark:hover:bg-gray-800/50">
                    <td className="p-2 text-center">
                      <input 
                        type="checkbox" 
                        checked={isSelected}
                        onChange={(e) => {
                          const checked = e.target.checked;
                          if (isPronunc) {
                            setSelectedPronunciations(prev => {
                              const next = { ...prev };
                              if (checked) next[u.word] = u.git;
                              else delete next[u.word];
                              return next;
                            });
                          } else {
                            setSelectedDefinitions(prev => {
                              const next = { ...prev };
                              if (checked) next[u.word] = u.git;
                              else delete next[u.word];
                              return next;
                            });
                          }
                        }}
                      />
                    </td>
                    <td className="p-2">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${isPronunc ? 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200' : 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200'}`}>
                        {u.type}
                      </span>
                    </td>
                    <td className="p-2 font-medium">{u.word}</td>
                    <td className="p-2 text-green-700 dark:text-green-400 max-w-[200px] truncate" title={u.git}>{u.git}</td>
                    <td className="p-2 text-gray-500 max-w-[200px] truncate" title={u.local}>
                      {u.status === 'new' ? <span className="italic text-xs">New</span> : u.local}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="flex justify-between items-center pt-2">
          <button 
            onClick={() => setIsOpen(false)}
            className="text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
          >
            Remind Me Later
          </button>
          <div className="flex gap-2">
            <button 
              onClick={() => handleApply(true)}
              className="px-4 py-2 text-sm border dark:border-gray-700 rounded hover:bg-gray-50 dark:hover:bg-gray-800"
            >
              Ignore All Updates
            </button>
            <button 
              onClick={() => handleApply(false)}
              className="px-4 py-2 text-sm bg-blue-600 text-white rounded hover:bg-blue-500 font-medium"
            >
              Save Selected
            </button>
          </div>
        </div>
      </div>
    </ModalFrame>
  );
}
