import { isKokoroModel } from '@/lib/shared/kokoro';

export const DEFAULT_TTS_LANGUAGE = 'en';

export interface TextToken {
  text: string;
  start: number;
  end: number;
}

const KOKORO_LANGUAGE_BY_PREFIX: Readonly<Record<string, string>> = {
  af: 'en-US',
  am: 'en-US',
  bf: 'en-GB',
  bm: 'en-GB',
  ef: 'es',
  em: 'es',
  ff: 'fr',
  hf: 'hi',
  hm: 'hi',
  if: 'it',
  im: 'it',
  jf: 'ja',
  jm: 'ja',
  pf: 'pt-BR',
  pm: 'pt-BR',
  zf: 'zh-CN',
  zm: 'zh-CN',
};

export const KOKORO_SUPPORTED_LANGUAGES = [
  'en',
  'es',
  'fr',
  'hi',
  'it',
  'ja',
  'pt-BR',
  'zh-CN',
] as const;

export function normalizeLanguageTag(
  language: string | null | undefined,
  fallback = DEFAULT_TTS_LANGUAGE,
): string {
  const candidate = language?.trim();
  if (!candidate || candidate.toLowerCase() === 'auto') return fallback;

  try {
    return Intl.getCanonicalLocales(candidate)[0] ?? fallback;
  } catch {
    return fallback;
  }
}

export function normalizeOptionalLanguageTag(language: unknown): string | null {
  if (typeof language !== 'string') return null;
  const candidate = language.trim().split(/[,\s]+/u)[0];
  if (!candidate) return null;
  try {
    return Intl.getCanonicalLocales(candidate)[0] ?? null;
  } catch {
    return null;
  }
}

export function toBaseLanguageCode(language: string | null | undefined): string {
  const normalized = normalizeLanguageTag(language);
  try {
    return new Intl.Locale(normalized).language;
  } catch {
    return normalized.split('-')[0]?.toLowerCase() || DEFAULT_TTS_LANGUAGE;
  }
}

export function inferKokoroLanguageFromVoice(voice: string | null | undefined): string | null {
  const languages = new Set(getKokoroVoiceLanguages(voice));

  return languages.size === 1 ? [...languages][0] : null;
}

export function getKokoroVoiceLanguages(voice: string | null | undefined): string[] {
  if (!voice?.trim()) return [];
  return Array.from(new Set(
    voice
      .split('+')
      .map((part) => part.trim().replace(/\([^)]*\)/g, ''))
      .map((name) => KOKORO_LANGUAGE_BY_PREFIX[name.slice(0, 2).toLowerCase()])
      .filter((language): language is string => Boolean(language)),
  ));
}

export function resolveTtsLanguage(input: {
  configuredLanguage?: string | null;
  voice?: string | null;
}): string {
  const configured = input.configuredLanguage?.trim();
  if (configured && configured.toLowerCase() !== 'auto') {
    return normalizeLanguageTag(configured);
  }

  return inferKokoroLanguageFromVoice(input.voice) ?? DEFAULT_TTS_LANGUAGE;
}

export function getLanguageDisplayName(language: string): string {
  try {
    return new Intl.DisplayNames(['en'], { type: 'language' }).of(language) || language;
  } catch {
    return language;
  }
}

export function getTtsLanguageCompatibilityWarnings(input: {
  model?: string | null;
  voice?: string | null;
  documentLanguage?: string | null;
}): string[] {
  if (!isKokoroModel(input.model || '')) return [];

  const documentLanguage = normalizeLanguageTag(input.documentLanguage);
  const documentBaseLanguage = toBaseLanguageCode(documentLanguage);
  const supportedBaseLanguages = new Set(KOKORO_SUPPORTED_LANGUAGES.map((language) => toBaseLanguageCode(language)));
  const voiceLanguages = getKokoroVoiceLanguages(input.voice);
  const voiceBaseLanguages = new Set(voiceLanguages.map((language) => toBaseLanguageCode(language)));
  const warnings: string[] = [];

  if (!supportedBaseLanguages.has(documentBaseLanguage)) {
    warnings.push(
      `Kokoro's built-in voice catalog does not include ${getLanguageDisplayName(documentLanguage)}.`,
    );
  }

  if (voiceBaseLanguages.size > 1) {
    warnings.push(
      `Selected Kokoro voices use multiple languages (${voiceLanguages.map(getLanguageDisplayName).join(', ')}).`,
    );
    return warnings;
  }

  const voiceLanguage = voiceLanguages[0];
  if (voiceLanguage && toBaseLanguageCode(voiceLanguage) !== documentBaseLanguage) {
    warnings.push(
      `Selected Kokoro voice is ${getLanguageDisplayName(voiceLanguage)}, but the document is ${getLanguageDisplayName(documentLanguage)}.`,
    );
  }

  return warnings;
}

export function normalizeUnicodeToken(text: string): string {
  return text
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}]+/gu, '');
}

export function segmentSentences(text: string, language?: string | null): string[] {
  const normalizedLanguage = normalizeLanguageTag(language);
  try {
    return [...new Intl.Segmenter(normalizedLanguage, { granularity: 'sentence' }).segment(text)]
      .map(({ segment }) => segment.trim())
      .filter(Boolean);
  } catch {
    return text.split(/(?<=[.!?。！？؟।])\s*/u).map((segment) => segment.trim()).filter(Boolean);
  }
}

export function segmentWords(text: string, language?: string | null): TextToken[] {
  const normalizedLanguage = normalizeLanguageTag(language);
  try {
    return [...new Intl.Segmenter(normalizedLanguage, { granularity: 'word' }).segment(text)]
      .filter((segment) => segment.isWordLike)
      .map((segment) => ({
        text: segment.segment,
        start: segment.index,
        end: segment.index + segment.segment.length,
      }));
  } catch {
    const tokens: TextToken[] = [];
    const wordRegex = /\S+/gu;
    let match: RegExpExecArray | null;
    while ((match = wordRegex.exec(text)) !== null) {
      tokens.push({
        text: match[0],
        start: match.index,
        end: match.index + match[0].length,
      });
    }
    return tokens;
  }
}
