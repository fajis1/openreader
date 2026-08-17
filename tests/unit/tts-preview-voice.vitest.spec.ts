import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, test } from 'vitest';

import {
  resolveTtsPreviewVoice,
  resolveTtsPronunciationPreviewTarget,
} from '../../src/lib/shared/tts-preview';

describe('TTS preview voice resolution', () => {
  test('preserves a user-selected Kokoro voice', () => {
    expect(resolveTtsPreviewVoice({
      requestedVoice: 'am_michael',
      providerRef: 'kokoro',
      providerType: 'custom-openai',
      model: 'kokoro',
    })).toBe('am_michael');
  });

  test('never forwards the legacy default sentinel to Kokoro', () => {
    expect(resolveTtsPreviewVoice({
      requestedVoice: 'default',
      providerRef: 'kokoro',
      providerType: 'custom-openai',
      model: 'kokoro',
    })).toBe('af_alloy');
  });

  test('uses the selected voice for a configured Kokoro provider', () => {
    expect(resolveTtsPronunciationPreviewTarget({
      requestedVoice: 'am_michael',
      providerRef: 'self-hosted-kokoro',
      providerType: 'custom-openai',
      model: 'kokoro',
    })).toEqual({
      providerRef: 'self-hosted-kokoro',
      providerType: 'custom-openai',
      model: 'kokoro',
      voice: 'am_michael',
      useConfiguredCredentials: true,
    });
  });

  test('keeps IPA previews on the shared Kokoro provider for non-Kokoro TTS', () => {
    expect(resolveTtsPronunciationPreviewTarget({
      requestedVoice: 'alloy',
      providerRef: 'openai',
      providerType: 'openai',
      model: 'gpt-4o-mini-tts',
    })).toEqual({
      providerRef: 'kokoro',
      providerType: 'custom-openai',
      model: 'kokoro',
      voice: 'af_heart',
      useConfiguredCredentials: false,
    });
  });

  test('exposes an account-synced default voice setting and uses it for previews', () => {
    const settings = fs.readFileSync(
      path.join(process.cwd(), 'src/components/SettingsModal.tsx'),
      'utf8',
    );
    const previewCallers = [
      'src/components/SmartAudioSettings.tsx',
      'src/components/PronunciationGuideManager.tsx',
      'src/components/doclist/BookPronunciationInspectorModal.tsx',
      'src/components/doclist/ScanForeignWordsModal.tsx',
    ].map((file) => fs.readFileSync(path.join(process.cwd(), file), 'utf8'));

    expect(settings).toContain('Default Voice');
    expect(settings).toContain("updateConfigKey('voice', nextVoice)");
    expect(settings).toContain('flushUserPreferencesSync()');
    expect(settings).toContain('const displayedDefaultVoice =');
    expect(settings).toContain('const nextVoice = displayedDefaultVoice;');
    for (const source of previewCallers) {
      expect(source).toContain('useTtsPreviewSettings');
      expect(source).toContain('voice: previewSettings.voice');
    }
    expect(previewCallers[2]).toContain('Preview voice: {previewSettings.voice}');
    expect(previewCallers[3]).toContain('Preview voice: {previewSettings.voice}');
  });

  test('enforces the server-side model policy before generating a preview', () => {
    const route = fs.readFileSync(
      path.join(process.cwd(), 'src/app/api/tts/preview/route.ts'),
      'utf8',
    );
    expect(route).toContain('resolveTtsModelForProvider({');
    expect(route).toContain('showAllProviderModels: runtimeConfig.showAllProviderModels');
    expect(route).not.toContain("voice = 'default'");
  });
});
