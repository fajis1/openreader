'use client';

import { useMemo } from 'react';
import { useConfig } from '@/contexts/ConfigContext';
import { resolveTtsPronunciationPreviewTarget } from '@/lib/shared/tts-preview';

export function useTtsPreviewSettings() {
  const { apiKey, baseUrl, providerRef, providerType, ttsModel, voice } = useConfig();

  return useMemo(() => {
    const target = resolveTtsPronunciationPreviewTarget({
      requestedVoice: voice,
      providerRef,
      providerType,
      model: ttsModel,
    });
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'x-tts-provider': target.providerRef,
      'x-tts-model': target.model,
    };
    if (target.useConfiguredCredentials) {
      headers['x-openai-key'] = apiKey;
      headers['x-openai-base-url'] = baseUrl;
    }

    return {
      voice: target.voice,
      provider: target.providerRef,
      model: target.model,
      headers,
    };
  }, [apiKey, baseUrl, providerRef, providerType, ttsModel, voice]);
}
