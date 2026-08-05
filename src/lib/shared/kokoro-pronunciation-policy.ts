import type { SmartAudioProfile } from '@/types/client';

export const KOKORO_PRONUNCIATION_POLICY_VERSION = 3;

export const KOKORO_COMPATIBILITY_POLICY = `KOKORO PRONUNCIATION COMPATIBILITY POLICY (REQUIRED, VERSION ${KOKORO_PRONUNCIATION_POLICY_VERSION}):
- Use English-compatible IPA intended for Kokoro.
- NEVER use the primary stress marker "ˈ"; it can cause ghost syllables.
- NEVER use a standalone "/o/"; use an English-compatible vowel such as "/oʊ/" or "/ɒ/" when appropriate.
- NEVER insert syllable-boundary periods between vowels.
- Do not use true pharyngeal fricatives such as "ħ" or "ʕ"; approximate them with English-compatible "/k/" or "/x/" sounds.
- NEVER place /y/ directly beside /j/ or repeat /j/; choose one appropriate glide so Kokoro does not speak separate letter names.
- For initialisms, use single capital letters separated by commas and spaces, such as "K, T, L"; NEVER group capitals as "TH, N".
- Preserve Kokoro markup exactly as "[Original Text](/IPA/)" when markup is requested.
- When returning pronunciation choices as JSON, return each pronunciation as a slash-delimited IPA string and no explanatory prose.
These compatibility requirements cannot be removed by profile-specific guidance.`;

export const DEFAULT_KOKORO_PRONUNCIATION_GUIDANCE = `DEFAULT KOKORO PRONUNCIATION GUIDANCE:
Prefer clear, natural English-compatible phonetic approximations that Kokoro can synthesize reliably.
For Koine Greek (Strict Erasmian), use these defaults where applicable: α=/ɑ/, ε=/ɛ/, η=/eɪ/, ι=/i/, ο=/oʊ/ or /ɒ/, υ=/u/, ω=/oʊ/, αι=/aɪ/, ει=/eɪ/, οι=/ɔɪ/, ου=/u/, ευ=/ju/, χ=/k/, θ=/θ/.
For Biblical Hebrew (Standard Academic), use these defaults where applicable: Qamats/Patah=/ɑ/, Tsere/Segol=/ɛ/ or /eɪ/, Hireq=/i/, Holem=/oʊ/, Shureq/Qibbuts=/u/, Shewa=/ə/ when vocal, and Het/Khaf=/k/ or /x/.
For Greek and Hebrew initialisms, abbreviations, and letter-based references, first determine from context whether the text is an abbreviation rather than a lexical word. Do not apply foreign-word IPA to an initialism. Transliterate the source letters into English letter names separated by commas and spaces so Kokoro speaks them individually; for example, Greek κτλ (the initialism of και τα λοιπά / “etc.”) becomes "K, T, L", and κ.τ.λ. follows the same rule. Do not expand the abbreviation unless the surrounding text explicitly provides its expansion. This initialism rule takes precedence over the normal Greek/Hebrew IPA rule.
For English heteronyms and ambiguous homographs (words spelled the same but pronounced differently, such as the proper name "Job" /dʒoʊb/ vs. the occupation "job", or "live" /laɪv/ vs. "live" /lɪv/), analyze the surrounding context carefully. Whenever context dictates a specific pronunciation that the TTS engine might get wrong, always supply the exact phonetic markup but prefix the IPA with an exclamation mark (e.g., [Job](!/dʒoʊb/) or [live](!/laɪv/)). This special syntax prevents heteronyms from polluting the global pronunciation dictionary.
For fantasy names, proper nouns, and other languages, favor a readable English-compatible pronunciation over narrow or unsupported IPA.`;



export interface PronunciationGuidanceProfile {
  pronunciationPromptMode?: 'default' | 'custom';
  customPronunciationPrompt?: string;
}

export function resolvePronunciationGuidance(
  profile?: PronunciationGuidanceProfile | SmartAudioProfile | null,
): string {
  if (profile?.pronunciationPromptMode === 'custom') {
    const custom = profile.customPronunciationPrompt?.trim();
    if (custom) return custom;
  }
  return DEFAULT_KOKORO_PRONUNCIATION_GUIDANCE;
}

export function buildKokoroPronunciationInstructions(
  profile?: PronunciationGuidanceProfile | SmartAudioProfile | null,
): string {
  return `${resolvePronunciationGuidance(profile)}\n\n${KOKORO_COMPATIBILITY_POLICY}`;
}

export function getKokoroPronunciationCompatibilityErrors(pronunciation: unknown): string[] {
  if (typeof pronunciation !== 'string') return ['Pronunciation must be text.'];
  const trimmed = pronunciation.trim();
  if (!/^\/[^/]+\/$/.test(trimmed)) return ['Pronunciation must be a single slash-delimited IPA value.'];

  const inner = trimmed.slice(1, -1);
  const errors: string[] = [];
  if (inner === 'o') errors.push('Standalone /o/ is not supported.');
  if (inner.includes('ˈ')) errors.push('Primary stress marker ˈ is not supported.');
  if (/[ħʕ]/u.test(inner)) errors.push('True pharyngeal fricatives are not supported.');
  if (/[aeiouɑɒɔəɛɪʊ]\.[aeiouɑɒɔəɛɪʊ]/iu.test(inner)) {
    errors.push('Syllable-boundary periods between vowels are not supported.');
  }
  return errors;
}

export function isKokoroCompatiblePronunciation(pronunciation: unknown): pronunciation is string {
  return getKokoroPronunciationCompatibilityErrors(pronunciation).length === 0;
}

export function getKokoroPronunciationQualityWarnings(
  _word: string,
  pronunciation: unknown,
): string[] {
  const warnings = [...getKokoroPronunciationCompatibilityErrors(pronunciation)];
  if (typeof pronunciation !== 'string') return warnings;
  const inner = pronunciation.trim().replace(/^\/|\/$/g, '');
  if (/[yj]{2,}/iu.test(inner)) {
    warnings.push('Suspicious adjacent /y/ and /j/ phonemes may be spoken as separate letter names.');
  }
  if (/\b(?:open|close|slash)\b/iu.test(inner)) {
    warnings.push('Contains markup words that may be spoken literally.');
  }
  if (/[\[\]()]|\s{2,}/u.test(inner)) {
    warnings.push('Contains unexpected markup or spacing inside the pronunciation.');
  }
  if (/[A-Z]{2,}/u.test(inner)) {
    warnings.push('Contains grouped capital letters; initialism letters must be separated.');
  }
  return [...new Set(warnings)];
}

export function isKokoroSafePronunciation(
  word: string,
  pronunciation: unknown,
): pronunciation is string {
  return getKokoroPronunciationQualityWarnings(word, pronunciation).length === 0;
}

export function filterKokoroCompatiblePronunciationRecord(value: unknown): Record<string, string> {
  if (typeof value !== 'object' || value === null) return {};
  const result: Record<string, string> = {};
  for (const [word, pronunciation] of Object.entries(value)) {
    const trimmedWord = word.trim();
    if (trimmedWord && isKokoroCompatiblePronunciation(pronunciation)) {
      if (/[\[\]{}()<>\d]/.test(trimmedWord)) continue;
      
      const hasLatin = /[A-Za-z]/.test(trimmedWord);
      const hasForeign = /[\u0370-\u03FF\u1F00-\u1FFF\u0590-\u05FF]/.test(trimmedWord);
      if (hasLatin && hasForeign) continue;

      result[trimmedWord] = (pronunciation as string).trim();
    }
  }
  return result;
}
