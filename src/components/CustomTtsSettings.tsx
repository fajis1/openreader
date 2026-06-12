/* eslint-disable no-restricted-syntax */
"use client";

import React, { useState, useEffect } from "react";
import { BASE_ABBREVIATIONS, BASE_BOOKS, PRESET_PROMPTS, PRESET_MODELS } from "./constants";

interface CustomTtsSettingsProps {
  bookId?: string; 
}

export default function CustomTtsSettings({ bookId = "default_book" }: CustomTtsSettingsProps) {
  // --- STATE MANAGEMENT ---
  const [apiKey, setApiKey] = useState("");
  const [maskedKey, setMaskedKey] = useState<string | null>(null); // NEW: Tracks the saved key from the server
  const [prompt, setPrompt] = useState("");
  const [aiModel, setAiModel] = useState(PRESET_MODELS[0].id);
  const [customModelId, setCustomModelId] = useState("");
  
  const [abbreviations, setAbbreviations] = useState(BASE_ABBREVIATIONS);
  const [pronunciations, setPronunciations] = useState<{ key: string; value: string }[]>([]);
  const [books, setBooks] = useState(BASE_BOOKS);

  const [selectedAbbrevs, setSelectedAbbrevs] = useState<number[]>([]);
  const [selectedPronuns, setSelectedPronuns] = useState<number[]>([]);
  const [selectedBooks, setSelectedBooks] = useState<number[]>([]);
  const [newBook, setNewBook] = useState({ key: "", value: "" });
  const [newAbbrev, setNewAbbrev] = useState({ key: "", value: "" });
  const [newPronun, setNewPronun] = useState({ key: "", value: "" });

  // NEW: Fetch the masked global API key when the component loads
  useEffect(() => {
    fetch('/api/tts-settings')
      .then(res => res.json())
      .then(data => {
        if (data.maskedKey) {
          setMaskedKey(data.maskedKey);
        }
      })
      .catch(err => console.error("Failed to load global key", err));
  }, []);

  // --- HANDLERS ---
  const handleAddAbbrev = () => {
    if (!newAbbrev.key || !newAbbrev.value) return;
    setAbbreviations([...abbreviations, newAbbrev]);
    setNewAbbrev({ key: "", value: "" });
  };

  const handleAddPronun = () => {
    if (!newPronun.key || !newPronun.value) return;
    setPronunciations([...pronunciations, newPronun]);
    setNewPronun({ key: "", value: "" });
  };

  const handleSave = async () => {
    const abbrevJson = abbreviations.reduce((acc, curr) => ({ ...acc, [curr.key]: curr.value }), {});
    const pronunJson = pronunciations.reduce((acc, curr) => ({ ...acc, [curr.key]: curr.value }), {});
    const booksJson = books.reduce((acc, curr) => ({ ...acc, [curr.key]: curr.value }), {});

    const finalModel = aiModel === "custom" ? customModelId.trim() : aiModel;

    if (aiModel === "custom" && !finalModel) {
      alert("Please enter a custom model name before saving.");
      return;
    }

    const payload = {
      bookId: bookId,
      aiModel: finalModel,
      geminiApiKey: apiKey, // Will be empty unless the user explicitly typed a new one
      customTtsPrompt: prompt,
      abbreviations: abbrevJson,
      pronunciations: pronunJson,
      books: booksJson,
    };
    
    try {
      const response = await fetch('/api/tts-settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (response.ok) {
        alert(`Settings saved!`);
        // If they entered a new key, visually update the masked key string
        if (apiKey) {
          setMaskedKey("••••••••••••" + apiKey.slice(-4));
          setApiKey(""); // Clear the input box for security
        }
      } else {
        alert("Failed to save settings. Check server logs.");
      }
    } catch (error) {
      console.error("Error saving settings:", error);
      alert("Network error while saving settings.");
    }
  };

  // --- UI RENDER ---
  return (
    <div className="max-w-4xl mx-auto p-6 space-y-8 bg-white dark:bg-gray-900 rounded-lg shadow-sm border border-gray-200 dark:border-gray-800">
      <div>
        <h2 className="text-2xl font-bold mb-1">Advanced Audiobook Settings</h2>
        <p className="text-gray-500 text-sm">Configure your AI pipeline for: <span className="font-mono text-blue-600 dark:text-blue-400">{bookId}</span></p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* --- AI MODEL SECTION --- */}
        <div className="space-y-3">
          <label className="block text-sm font-semibold">AI Processing Model</label>
          <select 
            className="w-full p-2 border rounded bg-gray-50 dark:bg-gray-800 dark:border-gray-700 text-gray-900 dark:text-gray-100 cursor-pointer"
            value={aiModel}
            onChange={(e) => setAiModel(e.target.value)}
          >
            {PRESET_MODELS.map((model) => (
              <option key={model.id} value={model.id}>
                {model.name}
              </option>
            ))}
          </select>
          
          {aiModel === "custom" && (
            <input
              type="text"
              className="w-full p-2 border rounded bg-white dark:bg-gray-900 border-blue-400 dark:border-blue-500 text-gray-900 dark:text-gray-100 placeholder-gray-400 text-sm font-mono shadow-inner"
              placeholder="e.g., gemini-1.5-pro-tuning-v2"
              value={customModelId}
              onChange={(e) => setCustomModelId(e.target.value)}
            />
          )}
          <p className="text-xs text-gray-400">Select or manually enter the model string for this book.</p>
        </div>

        {/* --- API KEY SECTION (UPDATED FOR GLOBAL LOGIC) --- */}
        <div className="space-y-3">
          <div className="flex justify-between items-end">
            <label className="block text-sm font-semibold">Google Gemini API Key</label>
            {/* Show the masked key if it exists */}
            {maskedKey && (
              <span className="text-xs font-mono bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400 px-2 py-0.5 rounded">
                Active: {maskedKey}
              </span>
            )}
          </div>
          <input
            type="password"
            className="w-full p-2 border rounded bg-gray-50 dark:bg-gray-800 dark:border-gray-700 text-gray-900 dark:text-gray-100"
            placeholder={maskedKey ? "Enter a new key to overwrite..." : "Enter your API key..."}
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
          />
          <p className="text-xs text-gray-400">
            {maskedKey 
              ? "Leave blank to continue using your active key for all books." 
              : "Required. This will be saved globally for your account."}
          </p>
        </div>
      </div>

      {/* --- PROMPT SECTION --- */}
      <div className="space-y-3">
        <div className="flex justify-between items-end">
          <label className="block text-sm font-semibold">Custom AI Instructions</label>
          <select 
            className="text-xs border rounded p-1.5 bg-gray-50 dark:bg-gray-800 dark:border-gray-700 text-gray-900 dark:text-gray-100 cursor-pointer"
            onChange={(e) => {
              const selected = PRESET_PROMPTS.find(p => p.name === e.target.value);
              if (selected) {
                setPrompt(selected.content);
              }
            }}
          >
            <option value="">-- Load a Template --</option>
            {PRESET_PROMPTS.map((preset) => (
              <option key={preset.name} value={preset.name}>
                {preset.name}
              </option>
            ))}
          </select>
        </div>
        <textarea
          className="w-full h-40 p-3 border rounded bg-gray-50 dark:bg-gray-800 dark:border-gray-700 text-gray-900 dark:text-gray-100 font-mono text-sm leading-relaxed"
          placeholder="Enter your specific formatting rules here..."
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
        />
      </div>

      {/* --- DICTIONARIES SECTION --- */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
  
        {/* 1. Abbreviations Section */}
        <div className="space-y-4 p-4 border rounded dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
          <div className="flex justify-between items-start">
            <div>
              <h3 className="font-semibold text-lg">Abbreviations</h3>
              <p className="text-xs text-gray-500">Static text expansion.</p>
            </div>
            <div className="flex gap-2">
              <button 
                onClick={() => setAbbreviations(BASE_ABBREVIATIONS)}
                className="text-xs bg-yellow-100 dark:bg-yellow-900 text-yellow-800 dark:text-yellow-200 px-2 py-1 rounded cursor-pointer hover:bg-yellow-200"
              >
                Reset
              </button>
              <label className="text-xs bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 px-2 py-1 rounded cursor-pointer hover:bg-gray-300 dark:hover:bg-gray-600">
                Import CSV
                <input type="file" accept=".csv" className="hidden" onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  const reader = new FileReader();
                  reader.onload = (ev) => {
                    const text = ev.target?.result as string;
                    const newItems = text.split('\n').map(line => {
                      const [key, value] = line.split(',');
                      return { key: key?.trim(), value: value?.trim() };
                    }).filter(item => item.key && item.value);
                    setAbbreviations([...abbreviations, ...newItems]);
                  };
                  reader.readAsText(file);
                }} />
              </label>
            </div>
          </div>
          
          <div className="flex gap-2">
            <input type="text" placeholder="Short (e.g. NT)" className="w-1/2 p-2 text-sm border rounded bg-white dark:bg-gray-900 dark:border-gray-700 text-gray-900 dark:text-gray-100" value={newAbbrev.key} onChange={(e) => setNewAbbrev({ ...newAbbrev, key: e.target.value })} />
            <input type="text" placeholder="Expanded" className="w-1/2 p-2 text-sm border rounded bg-white dark:bg-gray-900 dark:border-gray-700 text-gray-900 dark:text-gray-100" value={newAbbrev.value} onChange={(e) => setNewAbbrev({ ...newAbbrev, value: e.target.value })} />
            <button onClick={handleAddAbbrev} className="px-3 bg-blue-600 hover:bg-blue-700 text-white rounded font-bold shadow-sm">+</button>
          </div>
          
          <ul className="space-y-2 mt-4 max-h-96 overflow-y-auto pr-2">
            {abbreviations.map((item, idx) => (
              <li key={idx} className="flex items-center gap-3 text-sm bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-800 dark:text-gray-200 p-2 rounded shadow-sm">
                <input 
                  type="checkbox" 
                  checked={selectedAbbrevs.includes(idx)}
                  onChange={(e) => {
                    if (e.target.checked) setSelectedAbbrevs([...selectedAbbrevs, idx]);
                    else setSelectedAbbrevs(selectedAbbrevs.filter(i => i !== idx));
                  }} 
                />
                <span className="flex-1"><strong>{item.key}</strong> &rarr; {item.value}</span>
              </li>
            ))}
          </ul>
          <button 
            onClick={() => {
              setAbbreviations(abbreviations.filter((_, i) => !selectedAbbrevs.includes(i)));
              setSelectedAbbrevs([]);
            }}
            className="text-xs text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 font-bold"
          >
            Delete Selected
          </button>
        </div>

        {/* 2. Pronunciations Section */}
        <div className="space-y-4 p-4 border rounded dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
          <div className="flex justify-between items-start">
            <div>
              <h3 className="font-semibold text-lg">Pronunciations</h3>
              <p className="text-xs text-gray-500">Force specific phonetics.</p>
            </div>
            <label className="text-xs bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 px-2 py-1 rounded cursor-pointer hover:bg-gray-300 dark:hover:bg-gray-600">
              Import CSV
              <input type="file" accept=".csv" className="hidden" onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = (ev) => {
                  const text = ev.target?.result as string;
                  const newItems = text.split('\n').map(line => {
                    const [key, value] = line.split(',');
                    return { key: key?.trim(), value: value?.trim() };
                  }).filter(item => item.key && item.value);
                  setPronunciations([...pronunciations, ...newItems]);
                };
                reader.readAsText(file);
              }} />
            </label>
          </div>
          
          <div className="flex gap-2">
            <input type="text" placeholder="Word" className="w-1/2 p-2 text-sm border rounded bg-white dark:bg-gray-900 dark:border-gray-700 text-gray-900 dark:text-gray-100" value={newPronun.key} onChange={(e) => setNewPronun({ ...newPronun, key: e.target.value })} />
            <input type="text" placeholder="Phonetic" className="w-1/2 p-2 text-sm border rounded bg-white dark:bg-gray-900 dark:border-gray-700 text-gray-900 dark:text-gray-100" value={newPronun.value} onChange={(e) => setNewPronun({ ...newPronun, value: e.target.value })} />
            <button onClick={handleAddPronun} className="px-3 bg-blue-600 hover:bg-blue-700 text-white rounded font-bold shadow-sm">+</button>
          </div>
          
          <ul className="space-y-2 mt-4 max-h-96 overflow-y-auto pr-2">
            {pronunciations.map((item, idx) => (
              <li key={idx} className="flex items-center gap-3 text-sm bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-800 dark:text-gray-200 p-2 rounded shadow-sm">
                <input 
                  type="checkbox" 
                  checked={selectedPronuns.includes(idx)}
                  onChange={(e) => {
                    if (e.target.checked) setSelectedPronuns([...selectedPronuns, idx]);
                    else setSelectedPronuns(selectedPronuns.filter(i => i !== idx));
                  }} 
                />
                <span className="flex-1"><strong>{item.key}</strong> &rarr; {item.value}</span>
              </li>
            ))}
          </ul>
          <button 
            onClick={() => {
              setPronunciations(pronunciations.filter((_, i) => !selectedPronuns.includes(i)));
              setSelectedPronuns([]);
            }}
            className="text-xs text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 font-bold"
          >
            Delete Selected
          </button>
        </div>

        {/* 3. Biblical Books Section */}
        <div className="space-y-4 p-4 border rounded dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
          <div className="flex justify-between items-start">
            <div>
              <h3 className="font-semibold text-lg">Biblical Books</h3>
              <p className="text-xs text-gray-500">Structural expansion.</p>
            </div>
            <div className="flex gap-2">
              <button 
                onClick={() => setBooks(BASE_BOOKS)}
                className="text-xs bg-yellow-100 dark:bg-yellow-900 text-yellow-800 dark:text-yellow-200 px-2 py-1 rounded cursor-pointer hover:bg-yellow-200"
              >
                Reset
              </button>
              <label className="text-xs bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 px-2 py-1 rounded cursor-pointer hover:bg-gray-300 dark:hover:bg-gray-600">
                Import CSV
                <input type="file" accept=".csv" className="hidden" onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  const reader = new FileReader();
                  reader.onload = (ev) => {
                    const text = ev.target?.result as string;
                    const newItems = text.split('\n').map(line => {
                      const [key, value] = line.split(',');
                      return { key: key?.trim(), value: value?.trim() };
                    }).filter(item => item.key && item.value);
                    setBooks([...books, ...newItems]);
                  };
                  reader.readAsText(file);
                }} />
              </label>
            </div>
          </div>
          
          <div className="flex gap-2">
            <input type="text" placeholder="Short (e.g. Gen)" className="w-1/2 p-2 text-sm border rounded bg-white dark:bg-gray-900 dark:border-gray-700 text-gray-900 dark:text-gray-100" value={newBook.key} onChange={(e) => setNewBook({ ...newBook, key: e.target.value })} />
            <input type="text" placeholder="Full" className="w-1/2 p-2 text-sm border rounded bg-white dark:bg-gray-900 dark:border-gray-700 text-gray-900 dark:text-gray-100" value={newBook.value} onChange={(e) => setNewBook({ ...newBook, value: e.target.value })} />
            <button onClick={() => { if(newBook.key && newBook.value) { setBooks([...books, newBook]); setNewBook({key:"", value:""}) } }} className="px-3 bg-green-600 hover:bg-green-700 text-white rounded font-bold shadow-sm">+</button>
          </div>
          
          <ul className="space-y-2 mt-4 max-h-96 overflow-y-auto pr-2">
            {books.map((item, idx) => (
              <li key={idx} className="flex items-center gap-3 text-sm bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-800 dark:text-gray-200 p-2 rounded shadow-sm">
                <input 
                  type="checkbox" 
                  checked={selectedBooks.includes(idx)}
                  onChange={(e) => {
                    if (e.target.checked) setSelectedBooks([...selectedBooks, idx]);
                    else setSelectedBooks(selectedBooks.filter(i => i !== idx));
                  }} 
                />
                <span className="flex-1"><strong>{item.key}</strong> &rarr; {item.value}</span>
              </li>
            ))}
          </ul>
          <button 
            onClick={() => {
              setBooks(books.filter((_, i) => !selectedBooks.includes(i)));
              setSelectedBooks([]);
            }}
            className="text-xs text-red-500 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 font-bold"
          >
            Delete Selected
          </button>
        </div>
      </div>
      
      {/* Save Button */}
      <div className="pt-4 border-t dark:border-gray-800 flex justify-end">
        <button 
          onClick={handleSave} 
          className="bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-6 rounded shadow"
        >
          Save Configuration
        </button>
      </div>
    </div>
  );
}