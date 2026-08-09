export const SMART_AUDIO_OMIT_SENTINEL = '[OMIT]';

export const REQUIRED_SMART_AUDIO_CLEANUP_INSTRUCTIONS = `
OPENREADER REQUIRED OUTPUT AND STRUCTURE RULES (these rules override conflicting instructions above):
- Layout markers such as [LAYOUT_ENGINE_TAG: ...], [SYSTEM HINT: ...], and <openreader-layout ...> are private processing metadata. Never repeat, paraphrase, explain, or otherwise include them in the edited text.
- A LAYOUT_ENGINE_TAG describes the content immediately following it, up to the next layout marker. Omit non-narrative headers, footers, footnotes, vision footnotes, reference entries, tables, formulas, page numbers, images, and seals. Preserve ordinary narrative prose.
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
  const normalized = text.trim();
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
  options: { allowTaggedText?: boolean } = {},
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
    text: validateSmartAudioOutput(normalizedCandidate),
  };
}
