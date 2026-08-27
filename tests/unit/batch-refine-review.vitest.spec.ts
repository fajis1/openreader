import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';

import {
  calculateBatchRefineMetrics,
  parseBatchRefineAssessment,
} from '../../src/lib/server/audiobooks/batch-refine-assessment';
import {
  hasUntaggedScholarForeignScript,
  prepareScholarBatchRefineText,
} from '../../src/lib/server/audiobooks/batch-refine-scholar-safety';
import {
  BATCH_REFINE_RECORDING_OPTION_HELP,
  batchRefineFlagDefinitions,
  normalizeBatchRefineRecordingMode,
  resolveBatchRefineProfileCategory,
} from '../../src/lib/shared/batch-refine-review';

const source = (relativePath: string) => fs.readFileSync(
  path.join(process.cwd(), relativePath),
  'utf8',
);

describe('Batch Refine review policy', () => {
  test('defaults to review-first and resolves profile-aware categories', () => {
    expect(normalizeBatchRefineRecordingMode(undefined)).toBe('review');
    expect(normalizeBatchRefineRecordingMode('immediate')).toBe('immediate');
    expect(resolveBatchRefineProfileCategory({ workerMode: 'scholar' })).toBe('scholar');
    expect(resolveBatchRefineProfileCategory({ workerMode: 'bibliography-catcher' })).toBe('scholar');
    expect(resolveBatchRefineProfileCategory({ workerMode: 'multi-voice' })).toBe('drama');
    expect(resolveBatchRefineProfileCategory({ id: 'default', name: 'Biblical Scholarship', workerMode: 'standard' })).toBe('scholar');
    expect(resolveBatchRefineProfileCategory({ id: 'clean-litrpg-v2' })).toBe('litrpg');
    expect(resolveBatchRefineProfileCategory({ name: 'Ordinary Novel' })).toBe('standard');
  });

  test('keeps category-specific concerns separate and extensible', () => {
    const scholar = batchRefineFlagDefinitions('scholar').map((flag) => flag.id);
    const litrpg = batchRefineFlagDefinitions('litrpg').map((flag) => flag.id);
    const drama = batchRefineFlagDefinitions('drama').map((flag) => flag.id);

    expect(scholar).toContain('mixed-ipa-raw');
    expect(scholar).toContain('unpronounced-foreign-script');
    expect(scholar).toContain('citation-boundary');
    expect(litrpg).toContain('stat-block');
    expect(litrpg).toContain('invented-term');
    expect(drama).toContain('speaker-boundary');
    expect(drama).toContain('voice-markup');
    expect(litrpg).not.toContain('citation-boundary');
  });

  test('parses structured Gemini output without trimming proposed text', () => {
    const assessment = parseBatchRefineAssessment('standard', JSON.stringify({
      refinedText: '\nExact text with trailing space ',
      reviewPriority: 'medium',
      reviewFlags: ['grammar-join'],
      reviewNote: 'Check the sentence join.',
    }));

    expect(assessment.refinedText).toBe('\nExact text with trailing space ');
    expect(assessment.reviewPriority).toBe('medium');
    expect(assessment.reviewFlags).toEqual(['grammar-join']);
  });

  test('falls back to the exact response when structured output is unavailable', () => {
    const response = '  unchanged response\n';
    const assessment = parseBatchRefineAssessment('standard', response);
    expect(assessment.refinedText).toBe(response);
    expect(assessment.reviewPriority).toBe('high');
    expect(assessment.reviewFlags).toContain('ai-uncertain');
  });

  test('accepts a fenced structured response while preserving its text value', () => {
    const response = `\`\`\`json\n${JSON.stringify({
      refinedText: 'Exact proposal\n',
      reviewPriority: 'low',
      reviewFlags: [],
      reviewNote: '',
    })}\n\`\`\``;
    expect(parseBatchRefineAssessment('standard', response).refinedText).toBe('Exact proposal\n');
  });

  test('distinguishes raw Greek beside Kokoro markup from Greek inside the tag', () => {
    const taggedOnly = calculateBatchRefineMetrics({
      category: 'scholar',
      previousText: 'The word [λόγος](/logos/) remains.',
      proposedText: 'The word [λόγος](/logos/) remains!',
    });
    expect(taggedOnly.reviewFlags).not.toContain('mixed-ipa-raw');

    const mixed = calculateBatchRefineMetrics({
      category: 'scholar',
      previousText: 'The words [λόγος](/logos/) and θεός remain.',
      proposedText: 'The words remain.',
    });
    expect(mixed.reviewFlags).toContain('mixed-ipa-raw');
    expect(mixed.reviewFlags).toContain('unpronounced-foreign-script');
    expect(mixed.reviewFlags).toContain('pronunciation-markup');
    expect(mixed.reviewPriority).toBe('high');
  });

  test('tags known raw Greek and removes unresolved raw script before Scholar review', () => {
    const input = 'The words [μηδὲ](/meɪdɛ/) [ἐφθαρκέναι](/ɛfθɑrkɛnaɪ/) τοὺς [δικαστάς](/dɪkɑstɑs/) remain.';
    const known = prepareScholarBatchRefineText(input, { 'τοὺς': '/tus/' });

    expect(known.text).toBe('The words [μηδὲ](/meɪdɛ/) [ἐφθαρκέναι](/ɛfθɑrkɛnaɪ/) [τοὺς](/tus/) [δικαστάς](/dɪkɑstɑs/) remain.');
    expect(known.taggedTerms).toEqual(['τοὺς']);
    expect(known.removedTerms).toEqual([]);
    expect(hasUntaggedScholarForeignScript(known.text)).toBe(false);

    const unresolved = prepareScholarBatchRefineText('The word θεός remains.', {});
    expect(unresolved.text).toBe('The word remains.');
    expect(unresolved.removedTerms).toEqual(['θεός']);
    expect(hasUntaggedScholarForeignScript(unresolved.text)).toBe(false);
  });

  test('raises deterministic concern for very large deletions', () => {
    const metrics = calculateBatchRefineMetrics({
      category: 'standard',
      previousText: 'A'.repeat(100),
      proposedText: 'A'.repeat(10),
      aiPriority: 'low',
    });

    expect(metrics.reviewFlags).toEqual(expect.arrayContaining(['large-deletion', 'very-large-deletion']));
    expect(metrics.reviewPriority).toBe('high');
    expect(metrics.priorityScore).toBeGreaterThanOrEqual(70);
  });
});

describe('Batch Refine workflow integrity', () => {
  test('proposes changes only for canonical text and serves UTF-8 changelogs', () => {
    const worker = source('src/lib/server/audiobooks/refine.ts');
    const changelogRoute = source('src/app/api/audiobooks/batch-refine/changelog/route.ts');

    expect(worker).toContain('/^(\\d{1,6})__text\\.txt$/u');
    expect(worker).toContain('`__original.txt` extraction is never submitted');
    expect(worker).not.toContain('batch-regenerate');
    expect(changelogRoute.match(/text\/plain; charset=utf-8/g)).toHaveLength(2);
  });

  test('enforces the Scholar raw-script safety pass before review and recording', () => {
    const worker = source('src/lib/server/audiobooks/refine.ts');
    const reviewStore = source('src/lib/server/audiobooks/batch-refine-review-store.ts');
    const recordings = source('src/lib/server/audiobooks/batch-refine-recordings.ts');

    expect(worker.match(/prepareScholarBatchRefineText\(/g)).toHaveLength(2);
    expect(worker).toContain('globalPronunciationDefaults');
    expect(reviewStore).toContain('hasUntaggedScholarForeignScript(proposedText)');
    expect(recordings).toContain('hasUntaggedScholarForeignScript(currentText)');
  });

  test('exposes changed-only review, requested sorts, editing, and approvals', () => {
    const review = source('src/components/audiobooks/BatchRefineReviewModal.tsx');
    const start = source('src/app/(app)/listen/[bookId]/page.tsx');

    expect(review).toContain('Only chapters Gemini changed appear here');
    expect(review).toContain('Chapter order');
    expect(review).toContain('Most changed text');
    expect(review).toContain('Highest AI/review concern');
    expect(review).toContain('Approve All');
    expect(review).toContain('Approve Edit & Record');
    expect(review).toContain('Keep Previous');
    expect(start).toContain('BATCH_REFINE_RECORDING_OPTION_HELP');
    expect(BATCH_REFINE_RECORDING_OPTION_HELP.review.label).toBe('Review before recording');
    expect(BATCH_REFINE_RECORDING_OPTION_HELP.immediate.label).toBe('Record immediately');
    expect(start).toContain('Hold high-concern changes for review');
  });
});
