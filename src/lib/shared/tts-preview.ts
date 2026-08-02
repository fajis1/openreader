import { type TtsProviderType } from '@/lib/shared/tts-provider-catalog';
import { resolveTtsProviderModelPolicy } from '@/lib/shared/tts-provider-policy';

export function resolveTtsPreviewVoice(input: {
  requestedVoice?: string | null;
  providerRef: string;
  providerType: TtsProviderType;
  model: string;
}): string {
  const requested = input.requestedVoice?.trim();
  if (requested && requested !== 'default') return requested;
  return resolveTtsProviderModelPolicy({
    providerRef: input.providerRef,
    providerType: input.providerType,
    model: input.model,
  }).defaultVoices[0] || '';
}

export interface TtsPronunciationPreviewTarget {
  providerRef: string;
  providerType: TtsProviderType;
  model: string;
  voice: string;
  useConfiguredCredentials: boolean;
}

/**
 * Kokoro slash-delimited IPA markup is not portable to ordinary OpenAI TTS
 * models. Use the account's configured provider and voice when it is Kokoro;
 * otherwise retain the historical shared `kokoro` preview provider.
 */
export function resolveTtsPronunciationPreviewTarget(input: {
  requestedVoice?: string | null;
  providerRef: string;
  providerType: TtsProviderType;
  model: string;
}): TtsPronunciationPreviewTarget {
  const policy = resolveTtsProviderModelPolicy(input);
  if (policy.isKokoroModel) {
    return {
      providerRef: input.providerRef,
      providerType: input.providerType,
      model: input.model,
      voice: resolveTtsPreviewVoice(input),
      useConfiguredCredentials: true,
    };
  }

  return {
    providerRef: 'kokoro',
    providerType: 'custom-openai',
    model: 'kokoro',
    voice: 'af_heart',
    useConfiguredCredentials: false,
  };
}
