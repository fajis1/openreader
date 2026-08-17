import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, test } from 'vitest';

import {
  buildMultiVoiceCast,
  finalizeSmartAudioCharacterMap,
  estimateSpeakerSegmentAtTime,
  getDuplicateVoiceAssignments,
  getNarratorVoiceId,
  getCharacterMapReadiness,
  mergeExtractedCharacters,
  normalizeSmartAudioCharacterMap,
  parseVoiceTaggedText,
  requiresDramaAudiobookReplacement,
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

  test('reports shared voices across primary characters but ignores aliases', () => {
    const cast = completeCast();
    const duplicated = {
      ...cast,
      entries: {
        ...cast.entries,
        Mira: {
          name: 'Mira',
          description: 'Mage',
          sampleText: 'Spark.',
          voiceId: 'am_adam',
          aliasFor: null,
        },
        Champion: {
          name: 'Champion',
          description: 'Alias',
          sampleText: '',
          voiceId: null,
          aliasFor: 'Arin',
        },
      },
    };

    expect(getDuplicateVoiceAssignments(duplicated)).toEqual([
      { voiceId: 'am_adam', characterNames: ['Arin', 'Mira'] },
    ]);
  });

  test('resolves the reviewed narrator voice for audiobook generation settings', () => {
    expect(getNarratorVoiceId(completeCast())).toBe('af_heart');
    expect(getNarratorVoiceId({
      ...completeCast(),
      entries: {
        ...completeCast().entries,
        Narrator: { ...completeCast().entries.Narrator, voiceId: null },
      },
    })).toBeNull();
  });

  test('requires explicit replacement when converting existing regular audio to Drama', () => {
    expect(requiresDramaAudiobookReplacement({
      hasExistingChapters: true,
      requestedWorkerMode: 'multi-voice',
      previousUseSmartAudio: false,
      previousWorkerMode: null,
    })).toBe(true);
    expect(requiresDramaAudiobookReplacement({
      hasExistingChapters: true,
      requestedWorkerMode: 'multi-voice',
      previousUseSmartAudio: true,
      previousWorkerMode: 'multi-voice',
    })).toBe(false);
    expect(requiresDramaAudiobookReplacement({
      hasExistingChapters: false,
      requestedWorkerMode: 'multi-voice',
      previousUseSmartAudio: false,
      previousWorkerMode: null,
    })).toBe(false);
  });

  test('maps chapter playback time to the estimated active speaker turn', () => {
    expect(estimateSpeakerSegmentAtTime(['Short.', 'A much longer speaker turn with several words.'], 1, 10)).toBe(0);
    expect(estimateSpeakerSegmentAtTime(['Short.', 'A much longer speaker turn with several words.'], 8, 10)).toBe(1);
    expect(estimateSpeakerSegmentAtTime([], 1, 10)).toBeNull();
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

  test('coalesces consecutive turns from the same character after redundant attribution removal', () => {
    const resolved = resolveMultiVoiceWorkerResult({
      status: 'success',
      segments: [
        { speaker: 'Arin', voice_id: 'am_adam', text: 'I knew you would come.' },
        { speaker: 'Hero', voice_id: 'am_adam', text: 'Now let us finish this.' },
      ],
    }, buildMultiVoiceCast(completeCast()));

    expect(resolved.segments).toEqual([{
      speaker: 'Arin',
      voiceId: 'am_adam',
      text: 'I knew you would come.\n\nNow let us finish this.',
    }]);
    expect(resolved.taggedText.match(/<voice name=/gu)).toHaveLength(1);
  });

  test('preserves omitted Narrator attributions for review while excluding them from TTS parsing', () => {
    const resolved = resolveMultiVoiceWorkerResult({
      status: 'success',
      segments: [
        { speaker: 'Arin', text: 'First line.' },
        { speaker: 'Narrator', text: 'Charles replied.', omit_from_audio: true },
        { speaker: 'Arin', text: 'Second line.' },
      ],
    }, buildMultiVoiceCast(completeCast()));

    expect(resolved.taggedText).toContain('omitted="true"');
    expect(parseVoiceTaggedText(resolved.taggedText)).toHaveLength(2);
    expect(parseVoiceTaggedText(resolved.taggedText, { includeOmitted: true })).toMatchObject([
      { text: 'First line.' },
      { text: 'Charles replied.', omitted: true },
      { text: 'Second line.' },
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

  test('reconciles known pronunciations inside each voice segment', () => {
    const resolved = resolveMultiVoiceWorkerResult({
      status: 'success',
      segments: [
        { speaker: 'Narrator', text: 'He spoke [ὑμῖν](/hjuːmis/).' },
      ],
    }, cast, {
      authoritativePronunciations: { 'ὑμῖν': '/hjumin/' },
    });
    expect(resolved.segments[0].text).toBe('He spoke [ὑμῖν](/hjumin/).');
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
    expect(worker).toContain('redundant speech attribution');
    expect(worker).toContain('Dominic replied as he squirmed');
    expect(worker).toContain('any action/reaction clause is narrative prose and must remain');
    expect(worker).toContain('he softly muttered');
    expect(worker).toContain('preserve the entire segment');
    expect(worker).toContain('Petra shouted as a ball of water');
    expect(entrypoint).toContain('audiobook_worker.py');
    expect(legacyWorker).toContain('Start audiobook_worker.py instead.');
  });

  test('mounts casting gates and persists mobile review flags', () => {
    const queue = fs.readFileSync(path.join(process.cwd(), 'src/app/api/audiobooks/queue/route.ts'), 'utf8');
    const single = fs.readFileSync(path.join(process.cwd(), 'src/components/AudiobookExportModal.tsx'), 'utf8');
    const batch = fs.readFileSync(path.join(process.cwd(), 'src/components/doclist/BatchAudiobookSidebar.tsx'), 'utf8');
    const library = fs.readFileSync(path.join(process.cwd(), 'src/components/doclist/DocumentList.tsx'), 'utf8');
    const jobs = fs.readFileSync(path.join(process.cwd(), 'src/components/doclist/views/JobsInlineView.tsx'), 'utf8');
    const listenPage = fs.readFileSync(path.join(process.cwd(), 'src/app/(app)/listen/[bookId]/page.tsx'), 'utf8');
    const studio = fs.readFileSync(path.join(process.cwd(), 'src/components/audiobooks/MultiVoiceReviewStudio.tsx'), 'utf8');

    expect(queue).toContain("code: 'CHARACTER_CAST_REQUIRED'");
    expect(queue).toContain("code: 'AUDIOBOOK_REPLACEMENT_REQUIRED'");
    for (const surface of [single, batch, jobs]) expect(surface).toContain('<MultiVoiceCharacterModal');
    expect(library).toContain('Pre-Scan Drama Characters');
    expect(library).toContain('<MultiVoiceCharacterModal');
    expect(library).toContain('standalone');
    expect(single).toContain("{isDramaProfile ? 'Narrator Voice' : 'Voice'}");
    expect(single).toContain("dramaNarratorVoice || 'Not assigned yet'");
    expect(single).toContain('Pronunciation: {selectedSmartAudioProfile.pronunciationAiModel || selectedSmartAudioProfile.aiModel}');
    expect(single).toContain('handleStartGeneration(false, narratorVoice)');
    expect(fs.readFileSync(path.join(process.cwd(), 'src/components/doclist/MultiVoiceCharacterModal.tsx'), 'utf8'))
      .toContain('chosen by ${assignedToOthers.join');
    expect(batch).toContain('Audio Drama · Multiple voices');
    expect(batch).toContain('Narrator Voice');
    expect(batch).toContain('dramaNarratorVoices[doc.id]');
    expect(batch).toContain('Pronunciation: {selectedSmartAudioProfile.pronunciationAiModel || selectedSmartAudioProfile.aiModel}');
    expect(batch).toContain('settings: settingsFor(doc.id)');
    expect(single).toContain('Replace & Regenerate');
    expect(batch).toContain('Replace & Regenerate');
    expect(listenPage).toContain("fetch('/api/audiobook/review-flags'");
    expect(listenPage).toContain('Chapters & Speakers');
    expect(listenPage).toContain('Speaker segments for selected chapter');
    expect(listenPage).toContain('parseVoiceTaggedText(chapterText, { includeOmitted: true })');
    expect(listenPage).toContain('Removed from audio');
    expect(listenPage).toContain('restoreOmittedSegment(segmentIndex)');
    expect(listenPage).toContain('segment.speaker');
    expect(listenPage).toContain('updateSpeakerAssignment(segmentIndex, event.target.value)');
    expect(listenPage).toContain('setChapterText(renderVoiceSegments(parsed))');
    expect(listenPage).toContain('Apply Changes & Re-record Chunk');
    expect(listenPage).toContain('updateSpeakerText(segmentIndex, event.target.value)');
    expect(listenPage).toContain('previewSpeakerSegment(segmentIndex)');
    expect(listenPage).toContain('rerecordSpeakerSegment(segmentIndex)');
    expect(listenPage).toContain('Re-record this corrected turn and rebuild the containing audio chunk');
    expect(listenPage).toContain('Now playing');
    expect(listenPage).toContain('estimateSpeakerSegmentAtTime(');
    expect(listenPage).not.toContain('Future: Post this to a DB table');
    expect(studio).toContain('/api/audiobook/review-flags?documentId=');
  });

  test('keeps character discovery explicit and exclusive to Audio Drama', () => {
    const scanner = fs.readFileSync(
      path.join(process.cwd(), 'src/components/doclist/MultiVoiceCharacterModal.tsx'),
      'utf8',
    );
    const library = fs.readFileSync(
      path.join(process.cwd(), 'src/components/doclist/DocumentList.tsx'),
      'utf8',
    );
    const scanRoute = fs.readFileSync(
      path.join(process.cwd(), 'src/app/api/audiobook/characters/scan/route.ts'),
      'utf8',
    );
    const defaults = JSON.parse(fs.readFileSync(
      path.join(process.cwd(), 'src/lib/server/default_smart_audio_profiles.json'),
      'utf8',
    )) as { profiles: Array<{ name: string; workerMode?: string }> };

    expect(scanner).not.toContain('setTimeout(() => { if (!cancelled) void scanCharacters(); }, 0)');
    expect(scanner).toContain('Start Character Scan');
    expect(scanner).toContain('Regular LitRPG audiobooks do not scan characters');
    expect(scanner).toContain("standalone ? 'Save Cast' : 'Save Cast & Continue'");
    expect(scanner).toContain('duplicateVoiceByCharacter.has(character.name)');
    expect(scanner).toContain('Reusing it is allowed, but these characters may sound identical.');
    expect(library).toContain("profile.workerMode === 'multi-voice'");
    expect(scanRoute).toContain("profile.workerMode !== MULTI_VOICE_WORKER_MODE");
    expect(defaults.profiles.find((profile) => profile.name === 'LitRPG')?.workerMode).toBe('standard');
    expect(defaults.profiles.find((profile) => profile.name === 'LitRPG Audio Drama')?.workerMode).toBe('multi-voice');
  });
});
