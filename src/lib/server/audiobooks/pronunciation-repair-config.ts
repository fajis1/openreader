import { readSmartAudioProfilesDocument } from '@/lib/server/smart-audio-profiles';
import { resolvePronunciationAiModel } from '@/lib/shared/smart-audio-models';
import { GEMINI_MODEL_FALLBACKS } from '@/lib/server/smart-audio/gemini-failover';

export class PronunciationRepairError extends Error {}
export function pronunciationRepairErrorMessage(error: unknown): string {
  if (error instanceof PronunciationRepairError) return error.message;
  if (error instanceof Error && error.name === 'TimeoutError') return 'Gemini repair timed out. Retry this chapter later or choose another model/key.';
  if (error instanceof Error && error.name === 'AbortError') return 'Repair stopped. Saved proposals remain available.';
  return 'Pronunciation repair failed. See the server log using the request/job ID; no repair was approved automatically.';
}

export type RepairAiSelection = { profileId?: string; aiModel?: string; fallbackModels?: string[]; primaryKeyRef?: string; backupKeyRef?: string };

export async function loadPronunciationRepairConfig(userId: string) {
  const document = await readSmartAudioProfilesDocument(userId);
  const keys = new Map<string, { key: string; label: string }>();
  const add = (ref: string, key: string | undefined, label: string) => {
    if (key?.trim()) keys.set(ref, { key: key.trim(), label });
  };
  for (const profile of document.profiles) {
    add(`${profile.id}:primary`, profile.geminiApiKey, `${profile.name} — primary`);
    add(`${profile.id}:backup`, profile.backupGeminiApiKey, `${profile.name} — backup`);
  }
  add('server:primary', process.env.GEMINI_API_KEY, 'Server — primary');
  add('server:backup', process.env.BACKUP_GEMINI_API_KEY, 'Server — backup');
  const publicConfig = {
    selectedProfileId: document.selectedProfileId,
    modelFallbacks: GEMINI_MODEL_FALLBACKS,
    profiles: document.profiles.map(profile => ({ id: profile.id, name: profile.name, model: resolvePronunciationAiModel(profile),
      primaryKeyRef: keys.has(`${profile.id}:primary`) ? `${profile.id}:primary` : keys.has('server:primary') ? 'server:primary' : '',
      backupKeyRef: keys.has(`${profile.id}:backup`) ? `${profile.id}:backup` : keys.has('server:backup') ? 'server:backup' : '',
    })),
    keySources: [...keys].map(([ref, value]) => ({ ref, label: value.label, masked: value.key.length > 4 ? `...${value.key.slice(-4)}` : '***' })),
  };
  return { document, keys, publicConfig };
}

export async function resolveRepairAiSelection(userId: string, selection: RepairAiSelection) {
  const { document, keys, publicConfig } = await loadPronunciationRepairConfig(userId);
  const profile = document.profiles.find(item => item.id === (selection.profileId || document.selectedProfileId));
  if (!profile) throw new PronunciationRepairError('Selected Smart Audio profile no longer exists. Reload the repair settings.');
  const defaults = publicConfig.profiles.find(item => item.id === profile.id)!;
  const primaryKeyRef = selection.primaryKeyRef ?? defaults.primaryKeyRef;
  const backupKeyRef = selection.backupKeyRef ?? defaults.backupKeyRef;
  for (const ref of [primaryKeyRef, backupKeyRef]) {
    if (ref && !keys.has(ref)) throw new PronunciationRepairError('Selected Gemini key is no longer available. Reload the repair settings.');
  }
  const aiModel = selection.aiModel?.trim() || defaults.model;
  if (!/^[a-zA-Z0-9._-]{1,160}$/u.test(aiModel)) throw new PronunciationRepairError('Invalid Gemini model identifier.');
  const fallbackModels = selection.fallbackModels ?? [...(GEMINI_MODEL_FALLBACKS[aiModel] || [])];
  if (!Array.isArray(fallbackModels) || fallbackModels.length > 2 || fallbackModels.some(model => typeof model !== 'string' || !/^[a-zA-Z0-9._-]{1,160}$/u.test(model) || model === aiModel) || new Set(fallbackModels).size !== fallbackModels.length) throw new PronunciationRepairError('Choose up to two distinct fallback models different from the primary model.');
  return { profile, selection: { profileId: profile.id, aiModel, fallbackModels, primaryKeyRef, backupKeyRef },
    primaryApiKey: keys.get(primaryKeyRef)?.key || '', backupApiKey: keys.get(backupKeyRef)?.key || '' };
}
