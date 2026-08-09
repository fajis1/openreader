import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, test } from 'vitest';

import {
  buildMultiVoiceCast,
  finalizeSmartAudioCharacterMap,
  getCharacterMapReadiness,
  mergeExtractedCharacters,
  normalizeSmartAudioCharacterMap,
  parseVoiceTaggedText,
  renderVoiceSegments,
  resolveMultiVoiceWorkerResult,
} from '../../src/lib/shared/multi-voice';
import { buildCharacterScanSource } from '../../src/lib/server/audiobooks/document-source';

function completeCast() {
  return {
    schemaVersion: 1 as const,
    status: 'complete' as const,
    scannedAt: 123,
    profileId: 'litrpg',
    entries: {
      Narrator: {
        name: 'Narrator',
        description: 'Narration',
        sampleText: 'The gate opened.',
        voiceId: 'af_heart',
        aliasFor: null,
      },
      Arin: {
        name: 'Arin',
        description: 'Hero',
        sampleText: 'I accept the quest.',
        voiceId: 'am_adam',
        aliasFor: null,
      },
      Hero: {
        name: 'Hero',
        description: 'Alias',
        sampleText: '',
        voiceId: null,
        aliasFor: 'Arin',
      },
    },
  };
}

describe('LitRPG character casting', () => {
  test('normalizes voices and case-insensitive aliases without duplicate names', () => {
    const normalized = normalizeSmartAudioCharacterMap({
      ...completeCast(),
      entries: {
        Narrator: completeCast().entries.Narrator,
        Arin: completeCast().entries.Arin,
        arin: { ...completeCast().entries.Arin, name: 'arin', voiceId: 'not-a-real-voice' },
        Hero: { ...completeCast().entries.Hero, aliasFor: 'arin', voiceId: 'af_bella' },
      },
    });

    expect(Object.keys(normalized?.entries || {})).toEqual(['Narrator', 'Arin', 'Hero']);
    expect(normalized?.entries.Hero).toMatchObject({ aliasFor: 'Arin', voiceId: null });
  });

  test('requires a narrator and a voice for every primary cast member', () => {
    const complete = completeCast();
    const incomplete = {
      ...complete,
      status: 'partial' as const,
      entries: {
        Arin: { ...complete.entries.Arin, voiceId: null },
        Hero: complete.entries.Hero,
      },
    };

    expect(getCharacterMapReadiness(incomplete)).toMatchObject({
      ready: false,
      unassigned: ['Arin'],
      errors: ['The cast must include a Narrator.', 'Every primary character needs a voice.'],
    });
    expect(() => finalizeSmartAudioCharacterMap(incomplete)).toThrow(/Narrator/);
    expect(getCharacterMapReadiness({ ...completeCast(), needsRescan: true })).toMatchObject({
      ready: false,
      errors: ['The document narration filters changed; rescan the cast.'],
    });
  });

  test('rescanning preserves reviewed assignments and adds Narrator', () => {
    const merged = mergeExtractedCharacters({
      previous: completeCast(),
      characters: [
        { name: 'arin', description: 'Updated hero', sample_text: 'Again.' },
        { name: 'ARIN', description: 'Duplicate hallucination', sample_text: 'No.' },
        { name: 'Mira', description: 'Mage', sample_text: 'Spark.' },
      ],
      profileId: 'litrpg',
      sourceFingerprint: 'sha256:book',
      scannedAt: 456,
    });

    expect(Object.keys(merged.entries)).toEqual(['arin', 'Mira', 'Narrator']);
    expect(merged.entries.arin.voiceId).toBe('am_adam');
    expect(merged.entries.Narrator.voiceId).toBe('af_heart');
    expect(merged).toMatchObject({ status: 'partial', profileId: 'litrpg', sourceFingerprint: 'sha256:book' });
  });

  test('builds a worker cast with aliases attached to their primary', () => {
    expect(buildMultiVoiceCast(completeCast())).toEqual([
      { name: 'Narrator', voiceId: 'af_heart', aliases: [] },
      { name: 'Arin', voiceId: 'am_adam', aliases: ['Hero'] },
    ]);
  });
});

describe('LitRPG speaker output validation', () => {
  const cast = buildMultiVoiceCast(completeCast());

  test('accepts structured known speakers and renders fail-closed tags', () => {
    const resolved = resolveMultiVoiceWorkerResult({
      status: 'success',
      segments: [
        { speaker: 'Narrator', voice_id: 'af_heart', text: 'The gate opened.' },
        { speaker: 'Hero', voice_id: 'am_adam', text: 'I accept the quest.' },
      ],
      continuity_state: 'Arin entered the gate.',
      chapter_title: 'The First Gate',
    }, cast);

    expect(resolved.taggedText).toBe(
      '<voice name="af_heart">The gate opened.</voice>\n\n<voice name="am_adam">I accept the quest.</voice>',
    );
    expect(parseVoiceTaggedText(resolved.taggedText)).toEqual([
      { speaker: 'af_heart', voiceId: 'af_heart', text: 'The gate opened.' },
      { speaker: 'am_adam', voiceId: 'am_adam', text: 'I accept the quest.' },
    ]);
  });

  test('rejects invented speakers, changed voices, private markers, and nested tags', () => {
    const result = (segment: Record<string, unknown>) => ({ status: 'success', segments: [segment] });
    expect(() => resolveMultiVoiceWorkerResult(result({ speaker: 'Dragon', text: 'Roar.' }), cast)).toThrow(/unknown speaker/i);
    expect(() => resolveMultiVoiceWorkerResult(result({ speaker: 'Arin', voice_id: 'af_bella', text: 'No.' }), cast)).toThrow(/changed the assigned voice/i);
    expect(() => resolveMultiVoiceWorkerResult(result({ speaker: 'Arin', text: '[CONTINUITY: secret]' }), cast)).toThrow(/private control marker/i);
    expect(() => resolveMultiVoiceWorkerResult(result({ speaker: 'Arin', text: '<voice name="am_adam">No.</voice>' }), cast)).toThrow(/markup/i);
    expect(() => resolveMultiVoiceWorkerResult(result({ speaker: 'Arin', text: '<em>No.</em>' }), cast)).toThrow(/markup/i);
  });

  test('rejects unknown voices, malformed tags, and untagged gaps before TTS', () => {
    expect(() => parseVoiceTaggedText('<voice name="made_up">Hello.</voice>')).toThrow(/unsupported voice/i);
    expect(() => parseVoiceTaggedText('Outside <voice name="af_heart">Inside.</voice>')).toThrow(/outside a voice segment/i);
    expect(() => parseVoiceTaggedText('<voice name="af_heart">Unclosed')).toThrow(/outside a voice segment|malformed voice markup/i);
    expect(renderVoiceSegments([])).toBe('');
  });
});

describe('LitRPG source and production wiring', () => {
  test('samples every chapter and fingerprints the complete canonical source', () => {
    const chapters = [
      { title: 'Opening', text: `${'start '.repeat(80)}middle ${'end '.repeat(80)}` },
      { title: 'Dungeon', text: `${'torch '.repeat(80)}boss ${'loot '.repeat(80)}` },
      { title: 'Return', text: `${'home '.repeat(80)}feast ${'rest '.repeat(80)}` },
    ];
    const first = buildCharacterScanSource(chapters, 1_200);
    const second = buildCharacterScanSource(chapters, 1_200);
    const changed = buildCharacterScanSource([
      ...chapters.slice(0, 2),
      { ...chapters[2], text: `${chapters[2].text} Epilogue.` },
    ], 1_200);

    expect(first.text).toContain('### Opening');
    expect(first.text).toContain('### Dungeon');
    expect(first.text).toContain('### Return');
    expect(first.sourceFingerprint).toBe(second.sourceFingerprint);
    expect(first.sourceFingerprint).not.toBe(changed.sourceFingerprint);
  });

  test('ships Audio Drama handlers in the production audiobook worker', () => {
    const worker = fs.readFileSync(path.join(process.cwd(), 'audiobook_worker.py'), 'utf8');
    const legacyWorker = fs.readFileSync(path.join(process.cwd(), 'multivoice_worker.py'), 'utf8');
    const entrypoint = fs.readFileSync(path.join(process.cwd(), 'scripts/openreader-entrypoint.mjs'), 'utf8');
    expect(worker).toContain('await nc.subscribe("audiobooks.multivoice.extract"');
    expect(worker).toContain('await nc.subscribe("audiobooks.multivoice.assign"');
    expect(worker).toContain('VoiceAssignmentResult,');
    expect(entrypoint).toContain('audiobook_worker.py');
    expect(legacyWorker).toContain('Start audiobook_worker.py instead.');
  });

  test('mounts casting gates and persists mobile review flags', () => {
    const queue = fs.readFileSync(path.join(process.cwd(), 'src/app/api/audiobooks/queue/route.ts'), 'utf8');
    const single = fs.readFileSync(path.join(process.cwd(), 'src/components/AudiobookExportModal.tsx'), 'utf8');
    const batch = fs.readFileSync(path.join(process.cwd(), 'src/components/doclist/BatchAudiobookSidebar.tsx'), 'utf8');
    const jobs = fs.readFileSync(path.join(process.cwd(), 'src/components/doclist/views/JobsInlineView.tsx'), 'utf8');
    const listenPage = fs.readFileSync(path.join(process.cwd(), 'src/app/(app)/listen/[bookId]/page.tsx'), 'utf8');
    const studio = fs.readFileSync(path.join(process.cwd(), 'src/components/audiobooks/MultiVoiceReviewStudio.tsx'), 'utf8');

    expect(queue).toContain("code: 'CHARACTER_CAST_REQUIRED'");
    for (const surface of [single, batch, jobs]) expect(surface).toContain('<MultiVoiceCharacterModal');
    expect(listenPage).toContain("fetch('/api/audiobook/review-flags'");
    expect(listenPage).not.toContain('Future: Post this to a DB table');
    expect(studio).toContain('/api/audiobook/review-flags?documentId=');
  });
});
