import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CLEANUP_AI_MODEL,
  DEFAULT_PRONUNCIATION_AI_MODEL,
  resolveCleanupAiModel,
  resolvePronunciationAiModel,
} from '@/lib/shared/smart-audio-models';

const readSource = (relativePath: string) =>
  readFileSync(resolve(process.cwd(), relativePath), 'utf8');

describe('Smart Audio model selection', () => {
  it('uses separate economical cleanup and pronunciation defaults', () => {
    expect(DEFAULT_CLEANUP_AI_MODEL).toBe('gemini-3.1-flash-lite');
    expect(DEFAULT_PRONUNCIATION_AI_MODEL).toBe('gemini-3.6-flash');
    expect(resolveCleanupAiModel(undefined)).toBe(DEFAULT_CLEANUP_AI_MODEL);
    expect(resolvePronunciationAiModel(undefined)).toBe(DEFAULT_PRONUNCIATION_AI_MODEL);
    expect(DEFAULT_CLEANUP_AI_MODEL).not.toBe(DEFAULT_PRONUNCIATION_AI_MODEL);
  });

  it('preserves the single-model behavior of legacy profiles', () => {
    const legacyProfile = { aiModel: 'gemini-legacy-model' };

    expect(resolveCleanupAiModel(legacyProfile)).toBe('gemini-legacy-model');
    expect(resolvePronunciationAiModel(legacyProfile)).toBe('gemini-legacy-model');
  });

  it('honors an explicitly separated pronunciation model', () => {
    const splitProfile = {
      aiModel: 'cleanup-model',
      pronunciationAiModel: 'pronunciation-model',
    };

    expect(resolveCleanupAiModel(splitProfile)).toBe('cleanup-model');
    expect(resolvePronunciationAiModel(splitProfile)).toBe('pronunciation-model');
  });

  it('routes pronunciation and cleanup call sites through the correct resolver', () => {
    expect(readSource('src/app/api/documents/scan-foreign-words/route.ts'))
      .toContain('resolvePronunciationAiModel(activeProfile)');
    expect(readSource('src/app/api/tts/refine-pronunciations/route.ts'))
      .toContain('resolvePronunciationAiModel(activeProfile)');
    expect(readSource('src/lib/server/audiobooks/worker.ts'))
      .toContain('resolveCleanupAiModel(currentSelectedProfile)');
    expect(readSource('src/app/api/audiobook/chapter/route.ts'))
      .toContain('resolveCleanupAiModel(selectedProfile)');
  });

  it('shows both selectors and the active pronunciation model to users', () => {
    const settings = readSource('src/components/SmartAudioSettings.tsx');
    const scanner = readSource('src/components/doclist/ScanForeignWordsModal.tsx');

    expect(settings).toContain('PDF & Audiobook Cleanup Model');
    expect(settings).toContain('Pronunciation Model');
    expect(scanner).toContain('Pronunciation model:');
  });
});
