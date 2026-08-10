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
- Before responding, scan every [...](/.../) tag and correct any violation.`;

export const REQUIRED_SMART_AUDIO_CLEANUP_INSTRUCTIONS = `
OPENREADER REQUIRED OUTPUT AND STRUCTURE RULES (these rules override conflicting instructions above):
- Layout markers such as [LAYOUT_ENGINE_TAG: ...], [SYSTEM HINT: ...], and <openreader-layout ...> are private processing metadata. Never repeat, paraphrase, explain, or otherwise include them in the edited text.
- A LAYOUT_ENGINE_TAG describes the content immediately following it, up to the next layout marker. Omit non-narrative headers, footers, footnotes, vision footnotes, reference entries, tables, formulas, page numbers, images, and seals. Preserve ordinary narrative prose.
- Reconstruct OCR-damaged words when context, grammar, spelling, and surrounding text support a likely correction. Restore missing letters, replace visually confused characters, join incorrectly split words, and remove duplicated characters. This applies to English and foreign-language words. Always output the reconstructed complete word, never a surviving OCR fragment. If the intended reconstruction is genuinely ambiguous, make the most contextually defensible correction without inventing surrounding prose.
- Pronunciation markup may wrap exactly one corrected lexical word. The displayed word must match that pronunciation; never wrap a phrase, clause, or multiple space-separated words in one tag. Correct: [τὴν](/teɪn/) [θέσιν](/θɛsɪn/). Incorrect: [τὴν θέσιν](/teɪn θɛsɪn/).
- Repair contextually clear mixed-script OCR before adding pronunciation markup. For example, reconstruct a Greek word contaminated with visually similar Latin letters as the intended complete Greek word, then tag that corrected word individually. Never preserve mixed-script corruption inside a pronunciation tag or create a pronunciation for an incomplete fragment.
- Long foreign quotations must still be omitted according to the active foreign-quotation rule. Never evade that rule by wrapping an entire quotation in one pronunciation tag.
- If the input contains no narratable body text after cleanup, return exactly [OMIT] and nothing else. Never signal omission with an empty response.
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
const INTERNAL_LAYOUT_ELEMENT = /<\/?openreader-layout\b[^>]*>/gimu;
const INTERNAL_OUTPUT_MARKER = /\[\s*(?:LAYOUT_ENGINE_TAG|SYSTEM HINT|CHAPTER_TITLE)\s*:|\[\s*OMIT(?:TED)?\s*\]|<\/?openreader-layout\b/iu;
const KOKORO_PRONUNCIATION_TAG = /\[([^\]\r\n]+)\]\(\/([^/\r\n]+)\/\)/gu;

type PronunciationLookup = {
  exact: Map<string, string | null>;
  folded: Map<string, string | null>;
};

function buildPronunciationLookup(pronunciations: Record<string, string>): PronunciationLookup {
  const exact = new Map<string, string | null>();
  const folded = new Map<string, string | null>();
  for (const [rawWord, rawPronunciation] of Object.entries(pronunciations)) {
    const word = rawWord.trim().normalize('NFC');
    const pronunciation = typeof rawPronunciation === 'string' ? rawPronunciation.trim() : '';
    if (!word || /\s/u.test(word) || !/^\/[^/\r\n]+\/$/u.test(pronunciation)) continue;
    const previousExact = exact.get(word);
    if (previousExact === undefined) exact.set(word, pronunciation);
    else if (previousExact !== pronunciation) exact.set(word, null);
    const foldedWord = word.toLocaleLowerCase();
    const previous = folded.get(foldedWord);
    if (previous === undefined) folded.set(foldedWord, pronunciation);
    else if (previous !== pronunciation) folded.set(foldedWord, null);
  }
  return { exact, folded };
}

function lookupPronunciation(word: string, lookup: PronunciationLookup): string | null {
  const normalizedWord = word.normalize('NFC');
  return lookup.exact.get(normalizedWord)
    ?? lookup.folded.get(normalizedWord.toLocaleLowerCase())
    ?? null;
}

function hasPronunciationWord(word: string, lookup: PronunciationLookup): boolean {
  const normalizedWord = word.normalize('NFC');
  return lookup.exact.has(normalizedWord)
    || lookup.folded.has(normalizedWord.toLocaleLowerCase());
}

function scriptCount(value: string): number {
  return [
    /\p{Script=Latin}/u.test(value),
    /\p{Script=Greek}/u.test(value),
    /\p{Script=Hebrew}/u.test(value),
  ].filter(Boolean).length;
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
    const termWords = term.split(/\s+/u).filter(Boolean);
    const ipaWords = ipa.split(/\s+/u).filter(Boolean);

    if (termWords.length !== ipaWords.length) {
      throw new SmartAudioOutputValidationError(
        `Smart Audio pronunciation phrase cannot be aligned safely: ${term}`,
      );
    }

    const resolvedIpaWords = termWords.map((word, index) => {
      const authoritative = pronunciationLookup
        ? lookupPronunciation(word, pronunciationLookup)
        : null;
      return authoritative ? authoritative.slice(1, -1) : ipaWords[index];
    });

    for (const [index, word] of termWords.entries()) {
      assertSingleScriptWord(word);
      assertGreekInflectionEnding(word, resolvedIpaWords[index]);
    }
    return termWords
      .map((word, index) => `[${word}](/${resolvedIpaWords[index]}/)`)
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

/** Prevents Gemini from re-learning a conflicting value for a known word. */
export function selectUnknownSmartAudioPronunciations(
  learned: Record<string, string>,
  authoritative: Record<string, string>,
): Record<string, string> {
  const lookup = buildPronunciationLookup(authoritative);
  return Object.fromEntries(
    Object.entries(learned).filter(([word]) => !hasPronunciationWord(word, lookup)),
  );
}

export function stripSmartAudioInputMarkers(text: string): string {
  return text
    .replace(INTERNAL_INPUT_MARKER_LINE, '')
    .replace(INTERNAL_LAYOUT_ELEMENT, '')
    .replace(/\n{3,}/gu, '\n\n')
    .trim();
}

export class SmartAudioOutputValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SmartAudioOutputValidationError';
  }
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
    return { outcome: 'omitted', text: '' };
  }

  return {
    outcome: 'cleaned',
    text: validateSmartAudioOutput(options.authoritativePronunciations
      ? reconcileSmartAudioPronunciations(normalizedCandidate, options.authoritativePronunciations)
      : normalizedCandidate),
  };
}
