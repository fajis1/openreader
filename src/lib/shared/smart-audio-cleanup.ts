export const SMART_AUDIO_OMIT_SENTINEL = '[OMIT]';

export const FINAL_SMART_AUDIO_PRONUNCIATION_CHECK = `FINAL PRONUNCIATION-MARKUP CHECK (REQUIRED):
- Each pronunciation tag must contain exactly one corrected lexical word. Never put spaces inside the visible text or IPA of one tag.
- Split adjacent foreign words into separate tags. A phrase-level tag is invalid even when its combined IPA is accurate.
- First repair OCR corruption, then pronounce the corrected individual word. Long foreign quotations must be removed, not hidden inside pronunciation markup.
- INVALID: [καθ' υἱοθεσίαν δὲ](/kɑθ huioʊθɛsiɑn dɛ/)
  VALID: [καθ'](/kɑθ/) [υἱοθεσίαν](/huioʊθɛsiɑn/) [δὲ](/dɛ/)
- INVALID: [καὶ τὸ ἄγιον βάπτισμα](/kaɪ toʊ ɑɡioʊn bɑptɪsmɑ/)
  VALID: [καὶ](/kaɪ/) [τὸ](/toʊ/) [ἄγιον](/ɑɡioʊn/) [βάπτισμα](/bɑptɪsmɑ/)
- INVALID: [τὴν θέσιν](/teɪn θɛsɪn/)
  VALID: [τὴν](/teɪn/) [θέσιν](/θɛsɪn/)
- INVALID: [υἱός](/huɪɒn/) (the visible word ends in sigma, but this IPA ends in n and belongs to a different inflection)
  VALID: [υἱός](/huioʊs/)
- INVALID: [θετὸν](/θɛtɒs/) (the visible word ends in nu, but this IPA ends in s)
  VALID: [θετὸν](/θɛtɒn/)
- INVALID: [υἱοῦσθαι](/juoʊsθaɪ/) (the rough-breathing υἱ- onset must retain its h sound)
  VALID: [υἱοῦσθαι](/huioʊsθaɪ/)
- INVALID: [ἡgούμενοι](/heɪɡumɛnoɪ/) (Latin g is OCR corruption inside a Greek word)
  VALID: [ἡγούμενοι](/heɪɡumɛnoɪ/)
- Before responding, scan every [...](/.../) tag and correct any violation.`;

export const REQUIRED_SMART_AUDIO_CLEANUP_INSTRUCTIONS = `
OPENREADER REQUIRED OUTPUT AND STRUCTURE RULES (these rules override conflicting instructions above):
- Layout markers such as [LAYOUT_ENGINE_TAG: ...], [SYSTEM HINT: ...], and <openreader-layout ...> are private processing metadata. Never repeat, paraphrase, explain, or otherwise include them in the edited text.
- A LAYOUT_ENGINE_TAG describes the content immediately following it, up to the next layout marker. Omit non-narrative headers, footers, footnotes, vision footnotes, reference entries, tables, formulas, page numbers, images, and seals. Preserve ordinary narrative prose.
- Apply omission rules block by block. Never discard a mixed chunk merely because some blocks resemble an index, bibliography, table of contents, list, or reference section. If any coherent narrative prose or its associated heading remains, preserve it.
- Treat a bibliography or index as whole-section end matter only when a [SYSTEM HINT: ... end-matter ...] marker explicitly confirms its location. OpenReader emits that hint only at or after 70% through the book. Before that point, never infer whole-section end matter from formatting or a heading alone.
- Reconstruct OCR-damaged words when context, grammar, spelling, and surrounding text support a likely correction. Restore missing letters, replace visually confused characters, join incorrectly split words, and remove duplicated characters. This applies to English and foreign-language words. Always output the reconstructed complete word, never a surviving OCR fragment. If the intended reconstruction is genuinely ambiguous, make the most contextually defensible correction without inventing surrounding prose.
- Pronunciation markup may wrap exactly one corrected lexical word. The displayed word must match that pronunciation; never wrap a phrase, clause, or multiple space-separated words in one tag. Correct: [τὴν](/teɪn/) [θέσιν](/θɛsɪn/). Incorrect: [τὴν θέσιν](/teɪn θɛsɪn/).
- Repair contextually clear mixed-script OCR before adding pronunciation markup. For example, reconstruct a Greek word contaminated with visually similar Latin letters as the intended complete Greek word, then tag that corrected word individually. Never preserve mixed-script corruption inside a pronunciation tag or create a pronunciation for an incomplete fragment.
- Long foreign quotations must still be omitted according to the active foreign-quotation rule. Never evade that rule by wrapping an entire quotation in one pronunciation tag.
- Only when every substantive block is non-narrative after block-level cleanup, return exactly [OMIT]. If uncertain, preserve the original text. Never signal omission with an empty response.
- For narratable content, return only the cleaned audiobook text plus any separately requested chapter-title tag. Do not add commentary about your edits.
`.trim();

export function buildSmartAudioCleanupPrompt(profilePrompt: string | null | undefined): string {
  const savedPrompt = profilePrompt?.trim()
    || 'You are an expert audiobook preparation assistant. Clean the supplied text for natural narration.';
  return `${savedPrompt}\n\n${REQUIRED_SMART_AUDIO_CLEANUP_INSTRUCTIONS}`;
}

export function isScholarLikeSmartAudioMode(mode: string | null | undefined): boolean {
  return mode === 'scholar' || mode === 'bibliography-catcher';
}

const INTERNAL_INPUT_MARKER_LINE = /^[\t ]*\[(?:LAYOUT_ENGINE_TAG|SYSTEM HINT)\s*:[^\r\n]*\][\t ]*(?:\r?\n|$)/gimu;
const LAYOUT_INPUT_MARKER_LINE = /^[\t ]*\[LAYOUT_ENGINE_TAG\s*:\s*([^\]\r\n]+)\][\t ]*(?:\r?\n|$)/gimu;
const INTERNAL_LAYOUT_ELEMENT = /<\/?openreader-layout\b[^>]*>/gimu;
const INTERNAL_OUTPUT_MARKER = /\[\s*(?:LAYOUT_ENGINE_TAG|SYSTEM HINT|CHAPTER_TITLE)\s*:|\[\s*OMIT(?:TED)?\s*\]|<\/?openreader-layout\b/iu;
const KOKORO_PRONUNCIATION_TAG = /\[([^\]\r\n]+)\]\(\/([^/\r\n]+)\/\)/gu;
const CONFIRMED_END_MATTER_HINT = /\[SYSTEM HINT:[^\]\r\n]*\bend-matter\b[^\]\r\n]*\]/iu;
const NON_NARRATIVE_LAYOUT_KINDS = new Set([
  'chart',
  'footer',
  'footnote',
  'formula',
  'formula_number',
  'header',
  'image',
  'number',
  'reference',
  'reference_content',
  'seal',
  'table',
  'vision_footnote',
]);

type PronunciationLookup = {
  exact: Map<string, string | null>;
  folded: Map<string, string | null>;
  accentFolded: Map<string, string | null>;
  canonicalAccentFolded: Map<string, { word: string; pronunciation: string } | null>;
};

function accentFoldedWord(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Mark}/gu, '')
    .toLocaleLowerCase();
}

function setUniquePronunciation(
  target: Map<string, string | null>,
  key: string,
  pronunciation: string,
): void {
  const previous = target.get(key);
  if (previous === undefined) target.set(key, pronunciation);
  else if (previous !== pronunciation) target.set(key, null);
}

function buildPronunciationLookup(pronunciations: Record<string, string>): PronunciationLookup {
  const exact = new Map<string, string | null>();
  const folded = new Map<string, string | null>();
  const accentFolded = new Map<string, string | null>();
  const canonicalAccentFolded = new Map<string, { word: string; pronunciation: string } | null>();
  for (const [rawWord, rawPronunciation] of Object.entries(pronunciations)) {
    const word = rawWord.trim().normalize('NFC');
    const pronunciation = typeof rawPronunciation === 'string' ? rawPronunciation.trim() : '';
    if (!word || /\s/u.test(word) || !/^\/[^/\r\n]+\/$/u.test(pronunciation)) continue;
    setUniquePronunciation(exact, word, pronunciation);
    const foldedWord = word.toLocaleLowerCase();
    setUniquePronunciation(folded, foldedWord, pronunciation);
    const accentFoldedKey = accentFoldedWord(word);
    setUniquePronunciation(accentFolded, accentFoldedKey, pronunciation);
    const previousCanonical = canonicalAccentFolded.get(accentFoldedKey);
    if (previousCanonical === undefined) {
      canonicalAccentFolded.set(accentFoldedKey, { word, pronunciation });
    } else if (
      previousCanonical
      && (previousCanonical.word !== word || previousCanonical.pronunciation !== pronunciation)
    ) {
      canonicalAccentFolded.set(accentFoldedKey, null);
    }
  }
  return { exact, folded, accentFolded, canonicalAccentFolded };
}

function lookupPronunciation(word: string, lookup: PronunciationLookup): string | null {
  const normalizedWord = word.normalize('NFC');
  return lookup.exact.get(normalizedWord)
    ?? lookup.folded.get(normalizedWord.toLocaleLowerCase())
    ?? lookup.accentFolded.get(accentFoldedWord(normalizedWord))
    ?? null;
}

function scriptCount(value: string): number {
  return [
    /\p{Script=Latin}/u.test(value),
    /\p{Script=Greek}/u.test(value),
    /\p{Script=Hebrew}/u.test(value),
  ].filter(Boolean).length;
}

function repairUnambiguousGreekOcrSubstitution(word: string): string {
  if (!/\p{Script=Greek}/u.test(word) || /\p{Script=Hebrew}/u.test(word)) return word;
  const latinLetters = word.match(/\p{Script=Latin}/gu) || [];
  if (latinLetters.length !== 1) return word;
  const replacement = latinLetters[0] === 'g'
    ? 'γ'
    : latinLetters[0] === 'G'
      ? 'Γ'
      : null;
  if (!replacement) return word;
  return word.replace(/\p{Script=Latin}/u, replacement);
}

const LATIN_TO_GREEK_OCR: Readonly<Record<string, string>> = {
  a: 'α', b: 'β', d: 'δ', e: 'ε', g: 'γ', h: 'η',
  i: 'ι', k: 'κ', l: 'λ', m: 'μ', n: 'ν', o: 'ο', p: 'π',
  r: 'ρ', s: 'σ', t: 'τ', u: 'υ', v: 'ν', w: 'ω', x: 'χ', y: 'υ',
};

/**
 * Converts a mixed Greek/Latin OCR token only to look it up in an
 * authoritative dictionary. The converted text is never accepted by itself:
 * a unique reviewed dictionary spelling and pronunciation must exist.
 */
function greekDictionaryCandidate(word: string): string | null {
  if (!/\p{Script=Greek}/u.test(word) || !/\p{Script=Latin}/u.test(word)) return null;
  const characters = [...word];
  const converted = characters.map((character, index) => {
    if (!/\p{Script=Latin}/u.test(character)) return character;
    const lower = character.toLocaleLowerCase();
    let replacement = LATIN_TO_GREEK_OCR[lower];
    if (!replacement) return null;
    if (lower === 's' && index === characters.length - 1) replacement = 'ς';
    return character === character.toLocaleUpperCase()
      ? replacement.toLocaleUpperCase()
      : replacement;
  });
  return converted.includes(null) ? null : converted.join('');
}

function resolveAuthoritativeWord(
  word: string,
  lookup?: PronunciationLookup,
): { word: string; pronunciation: string | null } {
  const repairedWord = repairUnambiguousGreekOcrSubstitution(word);
  if (!lookup) return { word: repairedWord, pronunciation: null };
  const directPronunciation = lookupPronunciation(repairedWord, lookup);
  if (directPronunciation) return { word: repairedWord, pronunciation: directPronunciation };

  const dictionaryCandidate = greekDictionaryCandidate(word);
  const authoritative = dictionaryCandidate
    ? lookup.canonicalAccentFolded.get(accentFoldedWord(dictionaryCandidate))
    : null;
  return authoritative || { word: repairedWord, pronunciation: null };
}

function assertSingleScriptWord(word: string): void {
  if (scriptCount(word) > 1) {
    throw new SmartAudioOutputValidationError(
      `Smart Audio pronunciation tag contains mixed-script OCR text: ${word}`,
    );
  }
}

function assertGreekInflectionEnding(word: string, ipa: string): void {
  if (!/\p{Script=Greek}/u.test(word)) return;
  const normalizedWord = word.normalize('NFD').replace(/\p{Mark}/gu, '');
  const normalizedIpa = ipa.normalize('NFD').replace(/\p{Mark}/gu, '').trim().toLowerCase();
  if (/^υι/u.test(normalizedWord.toLowerCase()) && !/^h/u.test(normalizedIpa)) {
    throw new SmartAudioOutputValidationError(
      `Smart Audio pronunciation drops the rough-breathing h from a Greek υἱ- word: ${word}`,
    );
  }
  if (/ς$/u.test(normalizedWord) && /n$/u.test(normalizedIpa)) {
    throw new SmartAudioOutputValidationError(
      `Smart Audio pronunciation does not match the visible Greek inflection ending: ${word}`,
    );
  }
  if (/ν$/u.test(normalizedWord) && /[sz]$/u.test(normalizedIpa)) {
    throw new SmartAudioOutputValidationError(
      `Smart Audio pronunciation does not match the visible Greek inflection ending: ${word}`,
    );
  }
}

function rewriteSmartAudioPronunciationTags(
  text: string,
  pronunciationLookup?: PronunciationLookup,
): string {
  return text.replace(KOKORO_PRONUNCIATION_TAG, (_tag, rawTerm: string, rawIpa: string) => {
    const term = rawTerm.trim();
    const ipa = rawIpa.trim();
    const termWords = term
      .split(/\s+/u)
      .filter(Boolean)
      .map((word) => resolveAuthoritativeWord(word, pronunciationLookup));
    const ipaWords = ipa.split(/\s+/u).filter(Boolean);

    if (termWords.length !== ipaWords.length) {
      throw new SmartAudioOutputValidationError(
        `Smart Audio pronunciation phrase cannot be aligned safely: ${term}`,
      );
    }

    const resolvedIpaWords = termWords.map((word, index) => {
      return word.pronunciation ? word.pronunciation.slice(1, -1) : ipaWords[index];
    });

    for (const [index, word] of termWords.entries()) {
      assertSingleScriptWord(word.word);
      assertGreekInflectionEnding(word.word, resolvedIpaWords[index]);
    }
    return termWords
      .map((word, index) => `[${word.word}](/${resolvedIpaWords[index]}/)`)
      .join(' ');
  });
}

export function normalizeSmartAudioPronunciationTags(text: string): string {
  return rewriteSmartAudioPronunciationTags(text);
}

/**
 * Makes an existing dictionary entry authoritative without changing Gemini's
 * visible text or creating pronunciation tags for words Gemini did not tag.
 */
export function reconcileSmartAudioPronunciations(
  text: string,
  pronunciations: Record<string, string>,
): string {
  return rewriteSmartAudioPronunciationTags(text, buildPronunciationLookup(pronunciations));
}

export type SmartAudioPronunciationFallback = {
  text: string;
  discardedTags: number;
  errors: string[];
};

/**
 * Keeps valid/reconcilable tags and unwraps only invalid pronunciation tags.
 * Structural output errors are still rejected later by validateSmartAudioOutput.
 */
export function discardInvalidSmartAudioPronunciationTags(
  text: string,
  pronunciations: Record<string, string> = {},
): SmartAudioPronunciationFallback {
  const lookup = buildPronunciationLookup(pronunciations);
  const errors: string[] = [];
  const fallbackText = text.replace(
    KOKORO_PRONUNCIATION_TAG,
    (tag, rawTerm: string) => {
      try {
        return rewriteSmartAudioPronunciationTags(tag, lookup);
      } catch (error) {
        if (!(error instanceof SmartAudioOutputValidationError)) throw error;
        errors.push(error.message);
        return rawTerm.trim();
      }
    },
  );
  return { text: fallbackText, discardedTags: errors.length, errors };
}

export function stripSmartAudioInputMarkers(text: string): string {
  return text
    .replace(INTERNAL_INPUT_MARKER_LINE, '')
    .replace(INTERNAL_LAYOUT_ELEMENT, '')
    .replace(/\n{3,}/gu, '\n\n')
    .trim();
}

export function extractNarratableSmartAudioSourceText(text: string): string {
  const markers = [...text.matchAll(LAYOUT_INPUT_MARKER_LINE)];
  if (markers.length === 0) return stripSmartAudioInputMarkers(text);

  const narratableBlocks: string[] = [];
  for (const [index, marker] of markers.entries()) {
    const kind = marker[1].trim().toLocaleLowerCase().replaceAll('-', '_');
    if (NON_NARRATIVE_LAYOUT_KINDS.has(kind)) continue;
    const contentStart = (marker.index || 0) + marker[0].length;
    const contentEnd = markers[index + 1]?.index ?? text.length;
    const content = text.slice(contentStart, contentEnd).trim();
    if (content) narratableBlocks.push(content);
  }
  return stripSmartAudioInputMarkers(narratableBlocks.join('\n\n'));
}

export function hasConfirmedSmartAudioEndMatterHint(text: string): boolean {
  return CONFIRMED_END_MATTER_HINT.test(text);
}

export class SmartAudioOutputValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SmartAudioOutputValidationError';
  }
}

export class SmartAudioSuspiciousOmissionError extends SmartAudioOutputValidationError {
  constructor(message: string) {
    super(message);
    this.name = 'SmartAudioSuspiciousOmissionError';
  }
}

export function hasSubstantialSmartAudioSourceText(text: string): boolean {
  const source = extractNarratableSmartAudioSourceText(text);
  const letterCount = source.match(/\p{Letter}/gu)?.length || 0;
  const wordCount = source.match(/[\p{Letter}\p{Number}][\p{Letter}\p{Mark}\p{Number}'’.-]*/gu)?.length || 0;
  return letterCount >= 200 && wordCount >= 30;
}

export function validateSmartAudioOutput(text: string): string {
  const normalized = normalizeSmartAudioPronunciationTags(text.trim());
  if (!normalized) {
    throw new SmartAudioOutputValidationError(
      `Smart Audio returned empty text instead of ${SMART_AUDIO_OMIT_SENTINEL}.`,
    );
  }
  if (INTERNAL_OUTPUT_MARKER.test(normalized)) {
    throw new SmartAudioOutputValidationError(
      'Smart Audio output contained an internal control marker.',
    );
  }

  const nakedText = normalized.replace(KOKORO_PRONUNCIATION_TAG, '');
  if (/[\p{Script=Greek}\p{Script=Hebrew}]/u.test(nakedText)) {
    throw new SmartAudioOutputValidationError(
      'Smart Audio output contained bare Greek or Hebrew characters without pronunciation markup. You must either omit foreign text completely according to the omission rules, or individually tag each foreign word you keep.',
    );
  }

  return normalized;
}

type SmartAudioWorkerRecord = Record<string, unknown>;

export type ResolvedSmartAudioWorkerResult =
  | { outcome: 'cleaned'; text: string }
  | { outcome: 'omitted'; text: '' };

export function resolveSmartAudioWorkerResult(
  value: unknown,
  options: {
    allowTaggedText?: boolean;
    authoritativePronunciations?: Record<string, string>;
    allowSubstantialOmission?: boolean;
    sourceText?: string;
  } = {},
): ResolvedSmartAudioWorkerResult {
  if (!value || typeof value !== 'object') {
    throw new SmartAudioOutputValidationError('Smart Audio worker returned an invalid response.');
  }
  const result = value as SmartAudioWorkerRecord;
  if (result.status !== 'success') {
    const message = typeof result.message === 'string' && result.message.trim()
      ? result.message.trim()
      : 'unknown worker error';
    throw new SmartAudioOutputValidationError(`Smart Audio worker failed: ${message}`);
  }

  const declaredOutcome = result.outcome;
  if (
    declaredOutcome !== undefined
    && declaredOutcome !== 'cleaned'
    && declaredOutcome !== 'omitted'
  ) {
    throw new SmartAudioOutputValidationError('Smart Audio worker returned an unknown outcome.');
  }

  const cleanedText = typeof result.cleaned_text === 'string' ? result.cleaned_text : '';
  const taggedText = typeof result.tagged_text === 'string' ? result.tagged_text : '';
  const candidate = options.allowTaggedText && taggedText.trim() ? taggedText : cleanedText;
  const normalizedCandidate = candidate.trim();
  const sentinelOmission = /^\[(?:OMIT|OMITTED)\]$/iu.test(normalizedCandidate);

  if (declaredOutcome === 'omitted' || sentinelOmission) {
    if (declaredOutcome === 'omitted' && normalizedCandidate && !sentinelOmission) {
      throw new SmartAudioOutputValidationError(
        'Smart Audio worker returned text with an omitted outcome.',
      );
    }
    if (
      !options.allowSubstantialOmission
      && options.sourceText
      && hasSubstantialSmartAudioSourceText(options.sourceText)
    ) {
      throw new SmartAudioSuspiciousOmissionError(
        'Smart Audio omitted a substantial source chunk that still contains narratable text.',
      );
    }
    return { outcome: 'omitted', text: '' };
  }

  return {
    outcome: 'cleaned',
    text: validateSmartAudioOutput(options.authoritativePronunciations
      ? reconcileSmartAudioPronunciations(normalizedCandidate, options.authoritativePronunciations)
      : normalizedCandidate),
  };
}
