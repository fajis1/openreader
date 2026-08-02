import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';

const source = (relativePath: string) => fs.readFileSync(
  path.join(process.cwd(), relativePath),
  'utf8',
);

describe('Smart Audio data-integrity guards', () => {
  test('does not promote personal scan overrides into the global library', () => {
    const route = source('src/app/api/documents/scan-foreign-words/route.ts');
    expect(route).toContain('!compatibleOverrides[w]');
  });

  test('does not promote global Scholar defaults into the personal profile', () => {
    const worker = source('src/lib/server/audiobooks/worker.ts');
    expect(worker).toContain('termsNeedingGeneratedPronunciations');
    expect(worker).toContain('.filter((candidate) => !candidate.pronunciation)');
    expect(worker).toContain(
      '.filter((entry) => termsNeedingGeneratedPronunciations.has(entry.term))',
    );
  });

  test('serializes every PostgreSQL Smart Audio profile writer with the same lock', () => {
    const profiles = source('src/lib/server/smart-audio-profiles.ts');
    expect(profiles).toContain('pg_advisory_xact_lock');
    expect(profiles.match(/lockSmartAudioProfilesRow\(tx, userId\)/g)).toHaveLength(2);
  });

  test('preflights every selected batch document before creating queue jobs', () => {
    const sidebar = source('src/components/doclist/BatchAudiobookSidebar.tsx');
    const preflight = sidebar.indexOf('preflightOnly: true');
    const queueLoop = sidebar.indexOf('let count = 0');
    expect(preflight).toBeGreaterThan(0);
    expect(queueLoop).toBeGreaterThan(preflight);
  });

  test('persists the same resolved Smart Audio profile used for preflight', () => {
    const route = source('src/app/api/audiobooks/queue/route.ts');
    expect(route).toContain('resolvedSmartAudioProfileId');
    expect(route).toContain('smartAudioProfileId: resolvedSmartAudioProfileId');
    expect(route).toContain('...resolvedSettingsRecord');
  });

  test('does not deduplicate Resume against a recently completed job', () => {
    const route = source('src/app/api/audiobooks/queue/route.ts');
    expect(route).toContain('const activeJob = existingJobs.find');
    expect(route).not.toContain('now - (j.createdAt || 0) < 5000');
  });

  test('never changes settings on an already-active audiobook job', () => {
    const route = source('src/app/api/audiobooks/queue/route.ts');
    const activeBlock = route.slice(
      route.indexOf('if (activeJob)'),
      route.indexOf('let resolvedSmartAudioProfileId'),
    );
    expect(activeBlock).not.toContain('db.update(audiobookJobs)');
    expect(activeBlock).not.toContain('settingsJson:');
    expect(route.indexOf('if (activeJob)')).toBeLessThan(
      route.indexOf("code: 'SCHOLAR_SCAN_REQUIRED'"),
    );
  });

  test('merges global replacements under a transaction and updates personal entries separately', () => {
    const route = source('src/app/api/tts/global-pronunciations/rescan/route.ts');
    const scanRoute = source('src/app/api/documents/scan-foreign-words/route.ts');
    expect(route).toContain('await db.transaction');
    expect(route).toContain('pg_advisory_xact_lock');
    expect(route).toContain('const latestLibrary = normalizeGlobalLibrary');
    expect(route).toContain('personalWords');
    expect(route).toContain('replacedPersonal');
    expect(route).toContain('mergeGeneratedPronunciationsIntoLatestProfile');
    expect(route).toContain('JSON.stringify(latestLibrary[word] || []) === JSON.stringify(library[word] || [])');
    expect(scanRoute).toContain('updatedGlobalWords');
    expect(scanRoute).toContain('globalDictAtScanStart');
    expect(scanRoute).toContain('pg_advisory_xact_lock');
  });

  test('removes foreign passages at five words while preserving one-to-four-word terms', () => {
    const promptSources = [
      'src/components/constants.ts',
      'src/lib/server/default_smart_audio_profiles.json',
      'config/default_book_tts_settings.json',
    ].map(source);
    const wizard = source('src/components/SmartAudioWizardModal.tsx');

    for (const prompt of promptSources) {
      expect(prompt).toContain('5 or more words total');
      expect(prompt).toContain('1 to 4 words');
      expect(prompt).not.toContain('more than 5 words total');
      expect(prompt).not.toContain('1 to 5 words');
    }
    expect(wizard).toContain('5 or more words');
    expect(wizard).not.toContain('>5 words');
  });

  test('versions 12K chapter maps and retains legacy resume behavior', () => {
    const queueRoute = source('src/app/api/audiobooks/queue/route.ts');
    const worker = source('src/lib/server/audiobooks/worker.ts');
    const pipeline = source('src/lib/client/audiobooks/pipeline.ts');
    expect(queueRoute).toContain('queuedAudiobookBatchVersion(');
    expect(queueRoute).toContain('existingChapter.length > 0');
    expect(queueRoute).toContain('parseJobSettings(previousJob?.settingsJson)');
    expect(queueRoute).toContain("typeof value === 'string'");
    expect(worker).toContain('cleanupBatchTargetForVersion(jobSettings.cleanupBatchVersion)');
    expect(worker).toContain('if (usesCurrentBatching)');
    expect(worker).toContain("'audiobook.meta.json'");
    expect(pipeline).toContain(
      'let cleanupBatchVersion = CURRENT_AUDIOBOOK_BATCH_VERSION;',
    );
    expect(pipeline).toContain(
      'cleanupBatchVersion = existingData.settings?.cleanupBatchVersion ?? 1;',
    );
  });

  test('allows all capped global and personal pronunciation suspects to be rescanned', () => {
    const route = source('src/app/api/tts/global-pronunciations/rescan/route.ts');
    expect(route).toContain('const words = [...new Set([...globalWords, ...personalWords])];');
    expect(route).not.toMatch(/const (?:global|personal)Words = .*\.slice\(0, 50\)/);
    expect(route).toContain('const batchSize = 20;');
    expect(route).toContain('candidates.slice(offset, offset + batchSize)');
    expect(route).toContain('replacements[word][0].phonetic');
    expect(route).toContain('normalizeGeneratedPronunciation');
    expect(route).toContain('trimmed.replace(/^\\/|\\/$/g, \'\')');
    expect(route).toContain('Legacy global entries were often stored without slash wrappers');
    expect(route).toContain('const fallbackChoices');
    expect(route).toContain('const rejectedChoices = new Set');
    expect(route).toContain('!rejectedChoices.has(choice)');
    expect(route).toContain('better-sqlite3 transactions require a synchronous callback');
    expect(route).toContain('db.transaction((tx: typeof db) => {');
    expect(route).toContain('.limit(1)\n            .all();');
    expect(route).toContain('}).run();');

    const worker = source('src/lib/server/audiobooks/worker.ts');
    expect(worker).toContain('.limit(1)\n      .all();');
    expect(worker).toContain('}).run();');
  });

  test('audits both global and selected-profile pronunciation libraries before repair', () => {
    const route = source('src/app/api/tts/global-pronunciations/rescan/route.ts');
    expect(route).toContain('export async function GET');
    expect(route).toContain('const globalSuspects');
    expect(route).toContain('const personalSuspects');
    expect(route).toContain("profile?.pronunciations || {}");
    expect(route).toContain('globalWords: [...new Set(globalSuspects.map');
    expect(route).toContain('personalWords: [...new Set(personalSuspects.map');
    expect(route).toContain('Do not mix Erasmian, historical, modern, or reconstructed systems');
  });

  test('gives direct 12K cleanup requests the full worker timeout', () => {
    const route = source('src/app/api/audiobook/chapter/route.ts');
    expect(route).toContain(
      'nc.request(SMART_AUDIO_NATS_SUBJECT, sc.encode(payload), { timeout: 120000 })',
    );
  });

  test('uses the source document identity for direct Scholar lexicon lookup', () => {
    const route = source('src/app/api/audiobook/chapter/route.ts');
    const pipeline = source('src/lib/client/audiobooks/pipeline.ts');
    expect(route).toContain('const sourceDocumentId = data.documentId || bookId;');
    expect(route).toContain('readBookLexicon(storageUserId, sourceDocumentId)');
    expect(pipeline).toContain('documentId: sourceDocumentId');
  });

  test('offers an explicit Scholar auto-scan when regenerating a chapter', () => {
    const route = source('src/app/api/audiobook/chapter/route.ts');
    const modal = source('src/components/AudiobookExportModal.tsx');
    const client = source('src/lib/client/api/audiobooks.ts');
    expect(route).toContain('confirmScholarAutoScan');
    expect(route).toContain('resolveSmartAudioBookLexicon({');
    expect(route).toContain("status: 'partial'");
    expect(client).toContain('err.code = data?.code');
    expect(modal).toContain('pendingScholarRegeneration');
    expect(modal).toContain('handleRegenerateChapter(chapter, true)');
  });

  test('preflights direct Scholar regeneration before quota and isolates profile lexicons', () => {
    const route = source('src/app/api/audiobook/chapter/route.ts');
    expect(route.indexOf("code: 'SCHOLAR_SCAN_REQUIRED'")).toBeLessThan(
      route.indexOf('rateLimiter.checkAndIncrementLimit('),
    );
    expect(route).toContain(
      "const previousBookLexicon = bookLexicon?.profileId === selectedProfile.id",
    );
    expect(route).toContain('existing: previousBookLexicon');
    expect(route).toContain(
      'filterKokoroCompatiblePronunciationRecord(globalCandidates)',
    );
  });

  test('marks replacements for incompatible old global choices as Gemini recommendations', () => {
    const route = source('src/app/api/documents/scan-foreign-words/route.ts');
    expect(route).toContain('preExistingCompatibleGlobalWords');
    expect(route).toContain('preExistingCompatibleGlobalPhonetics');
    expect(route).toContain('!preExistingCompatibleGlobalWords.has(w)');
  });
});
