export const BATCH_REFINE_RECORDING_MODES = ['review', 'immediate'] as const;
export type BatchRefineRecordingMode = typeof BATCH_REFINE_RECORDING_MODES[number];

export const BATCH_REFINE_PROFILE_CATEGORIES = ['standard', 'scholar', 'litrpg', 'drama'] as const;
export type BatchRefineProfileCategory = typeof BATCH_REFINE_PROFILE_CATEGORIES[number];

export const BATCH_REFINE_REVIEW_PRIORITIES = ['low', 'medium', 'high'] as const;
export type BatchRefineReviewPriority = typeof BATCH_REFINE_REVIEW_PRIORITIES[number];

export type BatchRefineFlagDefinition = {
  id: string;
  label: string;
  description: string;
};

export type BatchRefineProfileReviewConfig = {
  label: string;
  description: string;
  assessmentGuidance: string;
  flags: readonly BatchRefineFlagDefinition[];
};

const COMMON_FLAGS: readonly BatchRefineFlagDefinition[] = [
  {
    id: 'large-deletion',
    label: 'Large deletion',
    description: 'The proposal removes at least one quarter of the previous chapter text.',
  },
  {
    id: 'very-large-deletion',
    label: 'Very large deletion',
    description: 'The proposal removes most of the previous chapter text and should be checked carefully.',
  },
  {
    id: 'entire-output-removed',
    label: 'Entire chapter removed',
    description: 'No speakable text remains. Approval removes this chapter from the recorded audiobook.',
  },
  {
    id: 'grammar-join',
    label: 'Sentence join',
    description: 'Gemini reports that a deletion may have left an awkward sentence boundary.',
  },
  {
    id: 'ai-uncertain',
    label: 'AI uncertain',
    description: 'Gemini marked the scope or correctness of this change as uncertain.',
  },
  {
    id: 'user-edited',
    label: 'Edited by reviewer',
    description: 'The reviewer edited Gemini’s proposal before approving it.',
  },
];

export const BATCH_REFINE_PROFILE_REVIEW_CONFIG: Record<BatchRefineProfileCategory, BatchRefineProfileReviewConfig> = {
  standard: {
    label: 'Standard audiobook',
    description: 'General prose and formatting review.',
    assessmentGuidance: 'Flag uncertain scope, damaged sentence joins, or formatting changes that extend beyond the requested rule.',
    flags: [
      {
        id: 'formatting-sensitive',
        label: 'Formatting-sensitive',
        description: 'The change affects structural whitespace, headings, quotation layout, or other formatting-sensitive text.',
      },
      {
        id: 'punctuation-heavy',
        label: 'Punctuation-heavy',
        description: 'The proposal changes a large amount of punctuation relative to its wording changes.',
      },
    ],
  },
  scholar: {
    label: 'Biblical Scholar',
    description: 'Ancient-language, definition, citation, and pronunciation review.',
    assessmentGuidance: 'Flag uncertain foreign OCR, mixed raw Greek or Hebrew and IPA, malformed pronunciation markup, lost inline definitions, or ambiguous citation boundaries.',
    flags: [
      {
        id: 'unpronounced-foreign-script',
        label: 'Untagged foreign script',
        description: 'Greek or Hebrew remains outside Kokoro pronunciation markup. Scholar recording is blocked until it is tagged or removed.',
      },
      {
        id: 'foreign-ocr',
        label: 'Foreign OCR uncertainty',
        description: 'The source contains foreign-script fragments that may be OCR damage rather than intentional terms.',
      },
      {
        id: 'mixed-ipa-raw',
        label: 'Mixed IPA and raw script',
        description: 'The affected text mixes Kokoro pronunciation tags with untagged Greek or Hebrew.',
      },
      {
        id: 'pronunciation-markup',
        label: 'Pronunciation markup',
        description: 'The proposal changes or removes Kokoro IPA markup.',
      },
      {
        id: 'definition-loss',
        label: 'Possible definition loss',
        description: 'An English gloss or inline definition may have been removed with a foreign term.',
      },
      {
        id: 'citation-boundary',
        label: 'Citation boundary',
        description: 'The change is close to a biblical or academic citation boundary.',
      },
    ],
  },
  litrpg: {
    label: 'LitRPG',
    description: 'System messages, invented terms, stat blocks, and game-formatting review.',
    assessmentGuidance: 'Flag game system messages, stat blocks, skill or item names, invented terms, or formatting whose removal may change gameplay meaning.',
    flags: [
      {
        id: 'stat-block',
        label: 'Stat block',
        description: 'The affected text resembles a character sheet, stat block, or formatted game-data panel.',
      },
      {
        id: 'system-message',
        label: 'System message',
        description: 'The proposal changes text that resembles an in-world system notification.',
      },
      {
        id: 'named-game-term',
        label: 'Named game term',
        description: 'A named skill, class, spell, item, rank, or other game-specific term may be affected.',
      },
      {
        id: 'invented-term',
        label: 'Invented term',
        description: 'The change contains a fictional or coined word that should not be treated as ordinary OCR damage.',
      },
      {
        id: 'formatting-sensitive',
        label: 'Formatting-sensitive',
        description: 'The change affects layout that may represent an audible system message or structured game content.',
      },
    ],
  },
  drama: {
    label: 'Audio Drama',
    description: 'Speaker, dialogue, narration, and voice-markup review.',
    assessmentGuidance: 'Flag changed voice tags, speaker boundaries, dialogue attribution, narration loss, or text spanning multiple speakers.',
    flags: [
      {
        id: 'voice-markup',
        label: 'Voice markup',
        description: 'The proposal changes or removes an Audio Drama voice tag.',
      },
      {
        id: 'speaker-boundary',
        label: 'Speaker boundary',
        description: 'The affected text is close to a transition between speakers.',
      },
      {
        id: 'dialogue-attribution',
        label: 'Dialogue attribution',
        description: 'A dialogue tag such as “said” or “asked” may have changed or been removed.',
      },
      {
        id: 'narration-loss',
        label: 'Possible narration loss',
        description: 'Narration outside dialogue may have been removed.',
      },
      {
        id: 'multi-speaker',
        label: 'Multiple speakers',
        description: 'The proposed change spans content assigned to more than one voice.',
      },
    ],
  },
};

export const BATCH_REFINE_RECORDING_OPTION_HELP: Record<BatchRefineRecordingMode, {
  label: string;
  description: string;
}> = {
  review: {
    label: 'Review before recording',
    description: 'Gemini changes are saved as proposals. Kokoro starts only after you approve an individual change or use Approve All.',
  },
  immediate: {
    label: 'Record immediately',
    description: 'Each eligible proposal is approved and queued for Kokoro as soon as Gemini finishes it. Existing audio remains until the replacement succeeds.',
  },
};

export function normalizeBatchRefineRecordingMode(value: unknown): BatchRefineRecordingMode {
  return value === 'immediate' ? 'immediate' : 'review';
}

export function resolveBatchRefineProfileCategory(profile: {
  id?: string | null;
  name?: string | null;
  workerMode?: string | null;
} | null | undefined): BatchRefineProfileCategory {
  if (profile?.workerMode === 'multi-voice') return 'drama';
  if (profile?.workerMode === 'scholar' || profile?.workerMode === 'bibliography-catcher') return 'scholar';
  const searchable = `${profile?.id || ''} ${profile?.name || ''}`.toLocaleLowerCase();
  if (searchable.includes('biblical') || searchable.includes('scholar')) return 'scholar';
  if (searchable.includes('litrpg') || searchable.includes('lit-rpg')) return 'litrpg';
  return 'standard';
}

export function batchRefineFlagDefinitions(category: BatchRefineProfileCategory): BatchRefineFlagDefinition[] {
  const unique = new Map<string, BatchRefineFlagDefinition>();
  for (const flag of [...COMMON_FLAGS, ...BATCH_REFINE_PROFILE_REVIEW_CONFIG[category].flags]) {
    unique.set(flag.id, flag);
  }
  return [...unique.values()];
}

export function normalizeBatchRefineFlagIds(
  category: BatchRefineProfileCategory,
  value: unknown,
): string[] {
  const allowed = new Set(batchRefineFlagDefinitions(category).map((flag) => flag.id));
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is string => typeof item === 'string' && allowed.has(item)))];
}

export function normalizeBatchRefineReviewPriority(value: unknown): BatchRefineReviewPriority {
  return value === 'high' || value === 'medium' ? value : 'low';
}

export function batchRefineAssessmentPrompt(category: BatchRefineProfileCategory): string {
  const config = BATCH_REFINE_PROFILE_REVIEW_CONFIG[category];
  const allowedFlags = batchRefineFlagDefinitions(category)
    .filter((flag) => flag.id !== 'user-edited')
    .map((flag) => flag.id)
    .join(', ');
  return [
    `REVIEW CATEGORY: ${config.label}.`,
    config.assessmentGuidance,
    `Allowed review flag identifiers: ${allowedFlags}.`,
    'Set reviewPriority to high only when a human should inspect the change before recording, medium when review would be useful, and low for a narrow confident change.',
    'Set reviewNote to one concise user-facing sentence describing the observable concern. Do not provide hidden reasoning or chain-of-thought.',
  ].join('\n');
}
