export const DEFAULT_CLEANUP_AI_MODEL = 'gemini-3.1-flash-lite';
export const DEFAULT_PRONUNCIATION_AI_MODEL = 'gemini-3.7-flash';
export const SMART_AUDIO_VALIDATION_REPAIR_MODEL = 'gemini-3.7-flash';

const SMART_AUDIO_REPAIR_ESCALATION_MODELS = new Set([
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
  'gemini-3.1-flash-lite',
  'gemini-3.5-flash-lite',
  'gemini-3.5-flash',
  'gemini-3.6-flash',
]);

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

export function resolveSmartAudioValidationRepairModel(
  requestedModel: string | null | undefined,
): string {
  const normalized = normalizedModel(requestedModel) || DEFAULT_CLEANUP_AI_MODEL;
  return SMART_AUDIO_REPAIR_ESCALATION_MODELS.has(normalized)
    ? SMART_AUDIO_VALIDATION_REPAIR_MODEL
    : normalized;
}
