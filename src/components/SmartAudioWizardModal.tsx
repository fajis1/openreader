import React, { useState } from 'react';
import { ModalFrame } from '@/components/ui';
import { PRESET_MODELS, PRESET_PROMPTS } from '@/components/constants';

interface SmartAudioWizardModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentApiKey?: string;
  currentApiKeyConfigured?: boolean;
  onSaveUniversalSetup: (config: {
    universalApiKey: string;
    backupApiKey: string;
    selectedModel: string;
    chosenWorkerMode: 'standard' | 'scholar';
    useGlobal: boolean;
    importGlobal: boolean;
  }) => Promise<void>;
}

export function SmartAudioWizardModal({
  isOpen,
  onClose,
  currentApiKey = '',
  currentApiKeyConfigured = false,
  onSaveUniversalSetup,
}: SmartAudioWizardModalProps) {
  const [step, setStep] = useState<number>(1);
  const [universalApiKey, setUniversalApiKey] = useState<string>(currentApiKey);
  const [backupApiKey, setBackupApiKey] = useState<string>('');
  const [selectedModel, setSelectedModel] = useState<string>('gemini-3.6-flash');
  const [chosenWorkerMode, setChosenWorkerMode] = useState<'standard' | 'scholar'>('scholar');
  const [scholarDefinitionChoice, setScholarDefinitionChoice] = useState<'with_definitions' | 'without_definitions'>('with_definitions');
  const [globalOption, setGlobalOption] = useState<'use_global' | 'import_global' | 'disabled'>('use_global');
  const [expandedPromptRule, setExpandedPromptRule] = useState<number | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const PROMPT_RULE_EXPLANATIONS = [
    {
      title: "1. OCR & Hyphenation Repair",
      desc: "Collapses English words broken across lines or hyphenated for emphasis (e.g., 'Le-VIT-i-cal' → 'Levitical'). Expands name suffixes ('Jr.' → 'Junior'). Never phoneticizes standard English."
    },
    {
      title: "2. Strict Seminary Pronunciation (Kokoro IPA)",
      desc: "Converts isolated Koine Greek and Biblical Hebrew words to English-compatible Kokoro IPA markup (e.g. '[καταλλάσσω](/kɑtɑlɑsoʊ/)'). BANS stress markers (ˈ) and lone /o/ to ensure clean TTS voice synthesis without ghost syllables."
    },
    {
      title: "3. Smart Citation Filtering",
      desc: "Retains citations attached to direct biblical quotes while stripping long reference lists like '(cf. Gen 1:26, 2:7; Rom 5:12)' and stranded footnote numbers."
    },
    {
      title: "4. Strict Preservation (No Summarization)",
      desc: "Retains 100% of the author's original words and meaning. Never paraphrases or summarizes content."
    },
    {
      title: "5. Cadence & Pause Optimization",
      desc: "Adds commas for natural breaths, em-dashes (—) for interruptions, and breaks long paragraphs to force long pauses in audio generation."
    },
    {
      title: "6. Metadata & Source Tag Cleanup",
      desc: "Deletes bracketed source markers (<source>), HTML tags, and decorative lines (****) before reading."
    },
    {
      title: "7. Smart Number Formatting",
      desc: "Keeps chapter and verse digits intact ('6:18') but replaces dash ranges with 'through' ('6:18 through 21') so the voice reader announces ranges correctly."
    },
    {
      title: "8. English Heteronym Correction",
      desc: "Applies IPA markup to ambiguous English words where spelling is identical but pronunciation depends on grammar: live (/lɪv/ vs /laɪv/), read (/rɛd/), wound (/wuːnd/), close (/kloʊs/), separate (/sɛpərɪt/), record, present."
    },
    {
      title: "9. Clean Return Format",
      desc: "Forces the AI to return raw processed manuscript text only with zero conversational preamble ('Here is your text')."
    },
    {
      title: "10. Table & Garbage Content Filter",
      desc: "Identifies PDF tables, index soup, and bibliography page lists and silences them so your audiobook doesn't read out tables."
    },
    {
      title: "11. Surgical Foreign Quote Pruning",
      desc: "Deletes full foreign language sentences (>5 words in German, French, etc.) while preserving short embedded Greek/Hebrew terms within English sentences."
    },
    {
      title: "12. Section Heading Pacing",
      desc: "Isolates section headings and chapter titles with double newlines so the TTS engine takes a dramatic pause before starting a new chapter."
    }
  ];

  const handleFinish = async () => {
    setIsSaving(true);
    try {
      const finalWorkerMode = chosenWorkerMode === 'scholar' && scholarDefinitionChoice === 'without_definitions' ? 'standard' : chosenWorkerMode;
      await onSaveUniversalSetup({
        universalApiKey,
        backupApiKey,
        selectedModel,
        chosenWorkerMode: finalWorkerMode,
        useGlobal: globalOption !== 'disabled',
        importGlobal: globalOption === 'import_global',
      });
      onClose();
    } catch (e) {
      console.error(e);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <ModalFrame open={isOpen} onClose={onClose} size="lg">
      <div className="flex flex-col max-h-[85vh] p-2">
        {/* Header Bar */}
        <div className="p-4 border-b dark:border-gray-800 flex justify-between items-center bg-gray-50 dark:bg-gray-800/60 rounded-t-xl">
          <div>
            <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
              <span>🪄</span> Smart Audio Guided Setup & License Lock
            </h3>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              Step {step} of 4: {
                step === 1 ? 'Universal API Key & Default AI Engine' :
                step === 2 ? 'Profile & Biblical Scholar Mode Selection' :
                step === 3 ? 'Global Learned Dictionary Setup' :
                'Interactive Prompt Rule Walkthrough (12 Points)'
              }
            </p>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-800 dark:hover:text-gray-200 text-lg font-bold">✕</button>
        </div>

        {/* Progress Bar */}
        <div className="w-full bg-gray-200 dark:bg-gray-700 h-1.5">
          <div
            className="bg-purple-600 h-1.5 transition-all duration-300"
            style={{ width: `${(step / 4) * 100}%` }}
          />
        </div>

        {/* Step Body */}
        <div className="p-6 overflow-y-auto flex-1 space-y-6">
          {step === 1 && (
            <div className="space-y-5">
              <div className="p-4 bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800 rounded-xl space-y-2">
                <h4 className="font-bold text-purple-900 dark:text-purple-300 text-base flex items-center gap-2">
                  <span>🔑</span> Universal Gemini API Key
                </h4>
                <p className="text-xs text-purple-800 dark:text-purple-300 leading-relaxed">
                  Enter your Gemini API key below. When you save this step, your API key will be <strong>universally applied across ALL your Smart Audio Profiles</strong> (LitRPG, Standard, and Biblical Scholar) so you never have to re-type it!
                </p>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-semibold mb-1 text-gray-900 dark:text-gray-100">
                    Primary Gemini API Key (e.g. Free Tier or Main Key) *
                  </label>
                  <input
                    type="password"
                    value={universalApiKey}
                    onChange={(e) => setUniversalApiKey(e.target.value)}
                    placeholder="AIzaSy..."
                    className="w-full p-2.5 border rounded-lg bg-white dark:bg-gray-900 border-gray-300 dark:border-gray-700 text-gray-900 dark:text-gray-100 font-mono text-sm shadow-sm"
                  />
                </div>

                <div>
                  <label className="block text-sm font-semibold mb-1 text-gray-900 dark:text-gray-100">
                    Backup Gemini API Key (Optional Pay-as-you-go Failover)
                  </label>
                  <input
                    type="password"
                    value={backupApiKey}
                    onChange={(e) => setBackupApiKey(e.target.value)}
                    placeholder="Optional backup key..."
                    className="w-full p-2.5 border rounded-lg bg-white dark:bg-gray-900 border-gray-300 dark:border-gray-700 text-gray-900 dark:text-gray-100 font-mono text-sm shadow-sm"
                  />
                </div>

                <div>
                  <label className="block text-sm font-semibold mb-1 text-gray-900 dark:text-gray-100">
                    Default AI Model Choice
                  </label>
                  <select
                    value={selectedModel}
                    onChange={(e) => setSelectedModel(e.target.value)}
                    className="w-full p-2.5 border rounded-lg bg-white dark:bg-gray-900 border-gray-300 dark:border-gray-700 text-gray-900 dark:text-gray-100 font-medium text-sm shadow-sm"
                  >
                    {PRESET_MODELS.map((m) => (
                      <option key={m.id} value={m.id}>{m.name}</option>
                    ))}
                  </select>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    <strong>Gemini 3.6 Flash</strong> is selected by default for maximum speed and superior Kokoro IPA phonetics.
                  </p>
                </div>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="space-y-5">
              <h4 className="font-bold text-gray-900 dark:text-gray-100 text-base">
                Step 2: Choose Your Primary Audio Processing Profile
              </h4>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* LitRPG & Standard Option */}
                <div
                  onClick={() => setChosenWorkerMode('standard')}
                  className={`p-4 rounded-xl border-2 cursor-pointer transition-all ${
                    chosenWorkerMode === 'standard'
                      ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20 shadow-md'
                      : 'border-gray-200 dark:border-gray-700 hover:border-gray-300'
                  }`}
                >
                  <div className="flex items-center gap-2 font-bold text-base text-gray-900 dark:text-gray-100 mb-1">
                    <span>⚔️</span> Standard AI Cleaner & LitRPG
                  </div>
                  <p className="text-xs text-gray-600 dark:text-gray-400 leading-relaxed">
                    Cleans formatting, fixes broken OCR, expands Bible verse references, and formats LitRPG stat sheets. Does NOT modify English text.
                  </p>
                </div>

                {/* Biblical Scholar Option */}
                <div
                  onClick={() => setChosenWorkerMode('scholar')}
                  className={`p-4 rounded-xl border-2 cursor-pointer transition-all ${
                    chosenWorkerMode === 'scholar'
                      ? 'border-purple-500 bg-purple-50 dark:bg-purple-900/20 shadow-md'
                      : 'border-gray-200 dark:border-gray-700 hover:border-gray-300'
                  }`}
                >
                  <div className="flex items-center gap-2 font-bold text-base text-gray-900 dark:text-gray-100 mb-1">
                    <span>📖</span> Biblical Scholar & Theology
                  </div>
                  <p className="text-xs text-gray-600 dark:text-gray-400 leading-relaxed">
                    Applies strict Erasmian Greek and Academic Hebrew Kokoro IPA phonetics, prunes long foreign quotes, and handles academic literature.
                  </p>
                </div>
              </div>

              {/* Explicit Warning Box when Biblical Scholar is selected */}
              {chosenWorkerMode === 'scholar' && (
                <div className="p-4 bg-amber-50 dark:bg-amber-950/40 border-2 border-amber-500 rounded-xl space-y-3">
                  <div className="flex items-center gap-2 text-amber-800 dark:text-amber-300 font-bold text-sm">
                    <span>⚠️ EXPLICIT DOCUMENT MODIFICATION NOTICE</span>
                  </div>
                  <p className="text-xs text-amber-900 dark:text-amber-200 leading-relaxed">
                    When you select the <strong>Biblical Scholar</strong> profile, your document text will be pre-processed by AI to insert <strong>inline English definitions/glosses</strong> directly next to isolated Koine Greek and Biblical Hebrew terms (e.g. converting <em>"λόγος"</em> to <em>"λόγος, word,"</em>).
                  </p>
                  
                  <div className="space-y-2 pt-1">
                    <label className="block text-xs font-bold text-amber-900 dark:text-amber-200">
                      Choose Your Definition Preference:
                    </label>
                    
                    <label className="flex items-center gap-2.5 p-2 rounded bg-white dark:bg-gray-900 border border-amber-200 dark:border-amber-800 cursor-pointer">
                      <input
                        type="radio"
                        name="scholarChoice"
                        checked={scholarDefinitionChoice === 'with_definitions'}
                        onChange={() => setScholarDefinitionChoice('with_definitions')}
                      />
                      <span className="text-xs font-semibold text-gray-900 dark:text-gray-100">
                        Include English Definitions (e.g., "λόγος, word,")
                      </span>
                    </label>

                    <label className="flex items-center gap-2.5 p-2 rounded bg-white dark:bg-gray-900 border border-amber-200 dark:border-amber-800 cursor-pointer">
                      <input
                        type="radio"
                        name="scholarChoice"
                        checked={scholarDefinitionChoice === 'without_definitions'}
                        onChange={() => setScholarDefinitionChoice('without_definitions')}
                      />
                      <span className="text-xs font-semibold text-gray-900 dark:text-gray-100">
                        DO NOT Add English Definitions (Use Standard IPA Markup Only)
                      </span>
                    </label>
                  </div>
                </div>
              )}
            </div>
          )}

          {step === 3 && (
            <div className="space-y-5">
              <h4 className="font-bold text-gray-900 dark:text-gray-100 text-base">
                Step 3: Global Learned Dictionary & Pronunciation Choices
              </h4>

              <p className="text-xs text-gray-600 dark:text-gray-400 leading-relaxed">
                OpenReader features a crowdsourced <strong>Global Learned Dictionary</strong> containing up to 5 community pronunciations per word. How would you like your profile to use it?
              </p>

              <div className="space-y-3">
                <label className={`flex items-start gap-3 p-3.5 border-2 rounded-xl cursor-pointer transition-all ${
                  globalOption === 'use_global' ? 'border-purple-500 bg-purple-50 dark:bg-purple-900/20' : 'border-gray-200 dark:border-gray-700'
                }`}>
                  <input
                    type="radio"
                    name="globalOpt"
                    checked={globalOption === 'use_global'}
                    onChange={() => setGlobalOption('use_global')}
                    className="mt-1"
                  />
                  <div>
                    <span className="font-bold text-sm block text-gray-900 dark:text-gray-100">Enable Global Learned Dictionary (Recommended)</span>
                    <span className="text-xs text-gray-500 dark:text-gray-400 block mt-0.5">Automatically applies crowdsourced global pronunciations. Your personal custom profile list will always take top priority!</span>
                  </div>
                </label>

                <label className={`flex items-start gap-3 p-3.5 border-2 rounded-xl cursor-pointer transition-all ${
                  globalOption === 'import_global' ? 'border-purple-500 bg-purple-50 dark:bg-purple-900/20' : 'border-gray-200 dark:border-gray-700'
                }`}>
                  <input
                    type="radio"
                    name="globalOpt"
                    checked={globalOption === 'import_global'}
                    onChange={() => setGlobalOption('import_global')}
                    className="mt-1"
                  />
                  <div>
                    <span className="font-bold text-sm block text-gray-900 dark:text-gray-100">Import Global List into My Personal Profile</span>
                    <span className="text-xs text-gray-500 dark:text-gray-400 block mt-0.5">Copies all current global pronunciation entries directly into your local profile so you can edit and tweak each word individually.</span>
                  </div>
                </label>

                <label className={`flex items-start gap-3 p-3.5 border-2 rounded-xl cursor-pointer transition-all ${
                  globalOption === 'disabled' ? 'border-purple-500 bg-purple-50 dark:bg-purple-900/20' : 'border-gray-200 dark:border-gray-700'
                }`}>
                  <input
                    type="radio"
                    name="globalOpt"
                    checked={globalOption === 'disabled'}
                    onChange={() => setGlobalOption('disabled')}
                    className="mt-1"
                  />
                  <div>
                    <span className="font-bold text-sm block text-gray-900 dark:text-gray-100">Disable Global Dictionary</span>
                    <span className="text-xs text-gray-500 dark:text-gray-400 block mt-0.5">Only use pronunciations explicitly typed into your personal profile.</span>
                  </div>
                </label>
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="space-y-4">
              <h4 className="font-bold text-gray-900 dark:text-gray-100 text-base">
                Step 4: Interactive Prompt Walkthrough (12 Core Rules)
              </h4>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Click any of the 12 rules below to understand how the AI prepares your text for the Kokoro TTS voice engine:
              </p>

              <div className="space-y-2 max-h-[50vh] overflow-y-auto pr-1">
                {PROMPT_RULE_EXPLANATIONS.map((rule, idx) => (
                  <div
                    key={idx}
                    className="border rounded-lg bg-white dark:bg-gray-900 border-gray-200 dark:border-gray-700 overflow-hidden"
                  >
                    <button
                      type="button"
                      onClick={() => setExpandedPromptRule(expandedPromptRule === idx ? null : idx)}
                      className="w-full p-3 text-left font-bold text-xs text-gray-900 dark:text-gray-100 flex justify-between items-center hover:bg-gray-50 dark:hover:bg-gray-800"
                    >
                      <span>{rule.title}</span>
                      <span>{expandedPromptRule === idx ? '▲' : '▼'}</span>
                    </button>
                    {expandedPromptRule === idx && (
                      <div className="p-3 pt-0 text-xs text-gray-600 dark:text-gray-300 leading-relaxed border-t border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/40">
                        {rule.desc}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer Bar */}
        <div className="p-4 border-t dark:border-gray-800 flex justify-between items-center bg-gray-50 dark:bg-gray-800/60 rounded-b-xl">
          {step > 1 ? (
            <button
              type="button"
              onClick={() => setStep(step - 1)}
              className="px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 font-bold text-xs rounded-lg hover:bg-gray-300 transition-colors"
            >
              Back
            </button>
          ) : (
            <div />
          )}

          {step < 4 ? (
            <button
              type="button"
              onClick={() => setStep(step + 1)}
              disabled={step === 1 && !universalApiKey.trim() && !currentApiKeyConfigured}
              className="px-5 py-2 bg-purple-600 text-white font-bold text-xs rounded-lg hover:bg-purple-700 transition-colors disabled:opacity-50"
            >
              Next Step &rarr;
            </button>
          ) : (
            <button
              type="button"
              onClick={handleFinish}
              disabled={isSaving}
              className="px-6 py-2.5 bg-green-600 text-white font-bold text-sm rounded-lg hover:bg-green-700 shadow-md transition-colors disabled:opacity-50"
            >
              {isSaving ? 'Saving Universal Setup...' : 'Complete & Apply Setup ✨'}
            </button>
          )}
        </div>
      </div>
    </ModalFrame>
  );
}
