export const DEFAULT_CLEANUP_AI_MODEL = 'gemini-3.1-flash-lite';
export const DEFAULT_PRONUNCIATION_AI_MODEL = 'gemini-3.7-flash';

type SmartAudioModelProfile = {
  aiModel?: string | null;
  pronunciationAiModel?: string | null;
};

function normalizedModel(value: string | null | undefined): string | null {
  const model = value?.trim();
  return model || null;
}

export function resolveCleanupAiModel(profile: SmartAudioModelProfile | null | undefined): string {
  return normalizedModel(profile?.aiModel) || DEFAULT_CLEANUP_AI_MODEL;
}

export function resolvePronunciationAiModel(
  profile: SmartAudioModelProfile | null | undefined,
): string {
  // Profiles saved before the split used aiModel for every Gemini task. Keep
  // that behavior until the user explicitly saves a pronunciation model.
  return normalizedModel(profile?.pronunciationAiModel)
    || normalizedModel(profile?.aiModel)
    || DEFAULT_PRONUNCIATION_AI_MODEL;
}
