import { createHash } from 'node:crypto';
import * as Diff from 'diff';

import {
  normalizeBatchRefineFlagIds,
  normalizeBatchRefineReviewPriority,
  type BatchRefineProfileCategory,
  type BatchRefineReviewPriority,
} from '@/lib/shared/batch-refine-review';

const FOREIGN_SCRIPT = /[\u0370-\u03ff\u1f00-\u1fff\u0590-\u05ff]/u;
const KOKORO_TAG = /\[[^\]\n]+\]\(\/[^/\n]+\/\)/u;
const KOKORO_TAG_GLOBAL = /\[[^\]\n]+\]\(\/[^/\n]+\/\)/gu;
const VOICE_TAG = /<\/?voice\b[^>]*>/giu;

export type BatchRefineAssessment = {
  refinedText: string;
  reviewPriority: BatchRefineReviewPriority;
  reviewFlags: string[];
  reviewNote: string | null;
};

export type BatchRefineMetrics = {
  sourceTextHash: string;
  proposedTextHash: string;
  diffText: string;
  changedCharacters: number;
  addedCharacters: number;
  removedCharacters: number;
  changePercent: number;
  reviewPriority: BatchRefineReviewPriority;
  priorityScore: number;
  reviewFlags: string[];
  reviewNote: string | null;
};

export function batchRefineTextHash(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function countVoiceTags(text: string): number {
  return text.match(VOICE_TAG)?.length ?? 0;
}

function deterministicFlags(
  category: BatchRefineProfileCategory,
  previousText: string,
  proposedText: string,
  removedCharacters: number,
): string[] {
  const flags: string[] = [];
  const removalRatio = removedCharacters / Math.max(1, previousText.length);
  if (removalRatio >= 0.25) flags.push('large-deletion');
  if (removalRatio >= 0.6) flags.push('very-large-deletion');
  if (!proposedText.trim()) flags.push('entire-output-removed');

  if (category === 'scholar') {
    const textOutsideKokoroTags = previousText.replace(KOKORO_TAG_GLOBAL, '');
    const hasUntaggedForeignScript = FOREIGN_SCRIPT.test(textOutsideKokoroTags);
    if (hasUntaggedForeignScript) flags.push('unpronounced-foreign-script');
    if (hasUntaggedForeignScript && KOKORO_TAG.test(previousText)) flags.push('mixed-ipa-raw');
    const previousKokoroTags = previousText.match(KOKORO_TAG_GLOBAL)?.length ?? 0;
    const proposedKokoroTags = proposedText.match(KOKORO_TAG_GLOBAL)?.length ?? 0;
    if (previousKokoroTags !== proposedKokoroTags) {
      flags.push('pronunciation-markup');
    }
  }

  if (category === 'litrpg') {
    if (/\[[^\]\n]{2,120}\]/u.test(previousText)) flags.push('stat-block');
    if (/\b(?:system|level|skill|class|rank|quest|achievement|experience|xp)\b/iu.test(previousText)) flags.push('system-message');
  }

  if (category === 'drama') {
    const beforeVoiceTags = countVoiceTags(previousText);
    const afterVoiceTags = countVoiceTags(proposedText);
    if (beforeVoiceTags !== afterVoiceTags) flags.push('voice-markup');
    if (beforeVoiceTags > 2) flags.push('multi-speaker');
    if (/\b(?:said|asked|replied|whispered|shouted|answered)\b/iu.test(previousText)
      && !/\b(?:said|asked|replied|whispered|shouted|answered)\b/iu.test(proposedText)) {
      flags.push('dialogue-attribution');
    }
  }

  return flags;
}

function priorityFromScore(score: number): BatchRefineReviewPriority {
  if (score >= 70) return 'high';
  if (score >= 35) return 'medium';
  return 'low';
}

export function calculateBatchRefineMetrics(input: {
  category: BatchRefineProfileCategory;
  previousText: string;
  proposedText: string;
  aiPriority?: unknown;
  aiFlags?: unknown;
  aiNote?: unknown;
  edited?: boolean;
}): BatchRefineMetrics {
  const changes = Diff.diffChars(input.previousText, input.proposedText);
  let addedCharacters = 0;
  let removedCharacters = 0;
  for (const change of changes) {
    if (change.added) addedCharacters += change.value.length;
    if (change.removed) removedCharacters += change.value.length;
  }
  const changedCharacters = addedCharacters + removedCharacters;
  const changePercent = Number(((changedCharacters / Math.max(1, input.previousText.length)) * 100).toFixed(2));
  const aiPriority = normalizeBatchRefineReviewPriority(input.aiPriority);
  const flags = normalizeBatchRefineFlagIds(input.category, [
    ...deterministicFlags(input.category, input.previousText, input.proposedText, removedCharacters),
    ...(Array.isArray(input.aiFlags) ? input.aiFlags : []),
    ...(input.edited ? ['user-edited'] : []),
  ]);

  let priorityScore = aiPriority === 'high' ? 70 : aiPriority === 'medium' ? 35 : 10;
  if (flags.includes('large-deletion')) priorityScore += 20;
  if (flags.includes('very-large-deletion')) priorityScore += 40;
  if (flags.includes('entire-output-removed')) priorityScore += 30;
  if (flags.includes('ai-uncertain')) priorityScore += 20;
  if (flags.includes('grammar-join')) priorityScore += 10;
  if (flags.includes('unpronounced-foreign-script')) priorityScore += 60;
  if (flags.includes('voice-markup')) priorityScore += 25;
  priorityScore = Math.min(100, priorityScore);

  return {
    sourceTextHash: batchRefineTextHash(input.previousText),
    proposedTextHash: batchRefineTextHash(input.proposedText),
    diffText: Diff.createTwoFilesPatch(
      'Previous approved text',
      'Gemini proposal',
      input.previousText,
      input.proposedText,
      'Previous',
      input.edited ? 'Edited proposal' : 'AI proposal',
    ),
    changedCharacters,
    addedCharacters,
    removedCharacters,
    changePercent,
    reviewPriority: priorityFromScore(priorityScore),
    priorityScore,
    reviewFlags: flags,
    reviewNote: typeof input.aiNote === 'string' && input.aiNote.trim()
      ? input.aiNote.trim().slice(0, 300)
      : null,
  };
}

export function parseBatchRefineAssessment(
  category: BatchRefineProfileCategory,
  responseText: string,
): BatchRefineAssessment {
  const jsonCandidate = /^```(?:json)?\s*([\s\S]*?)\s*```$/iu.exec(responseText.trim())?.[1]
    ?? responseText;
  try {
    const parsed = JSON.parse(jsonCandidate) as Record<string, unknown>;
    if (typeof parsed.refinedText !== 'string') throw new Error('Missing refinedText');
    return {
      refinedText: parsed.refinedText,
      reviewPriority: normalizeBatchRefineReviewPriority(parsed.reviewPriority),
      reviewFlags: normalizeBatchRefineFlagIds(category, parsed.reviewFlags),
      reviewNote: typeof parsed.reviewNote === 'string' && parsed.reviewNote.trim()
        ? parsed.reviewNote.trim().slice(0, 300)
        : null,
    };
  } catch {
    return {
      refinedText: responseText,
      reviewPriority: 'high',
      reviewFlags: ['ai-uncertain'],
      reviewNote: 'Gemini did not return structured review metadata; inspect this proposal before recording.',
    };
  }
}
