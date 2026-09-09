import { beforeEach, expect, test, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock('@/lib/server/smart-audio-profiles', () => ({ readSmartAudioProfilesDocument: (...args: unknown[]) => mocks.read(...args) }));
import { loadPronunciationRepairConfig, resolveRepairAiSelection, pronunciationRepairErrorMessage } from '@/lib/server/audiobooks/pronunciation-repair-config';
beforeEach(() => {
  vi.stubEnv('GEMINI_API_KEY', ''); vi.stubEnv('BACKUP_GEMINI_API_KEY', '');
  mocks.read.mockResolvedValue({ selectedProfileId: 'one', profiles: [
    { id: 'one', name: 'Scholar', pronunciationAiModel: 'gemini-3.8-flash', geminiApiKey: 'fixture-primary-1111', backupGeminiApiKey: 'fixture-backup-2222' },
    { id: 'two', name: 'Drama', pronunciationAiModel: 'custom-model', geminiApiKey: 'fixture-other-3333' },
  ] });
});
test('returns only masks and references to the browser', async () => {
  const { publicConfig } = await loadPronunciationRepairConfig('owner');
  expect(JSON.stringify(publicConfig)).not.toContain('fixture-');
  expect(publicConfig.keySources[0].masked).toBe('...1111');
  expect(publicConfig.profiles[0].model).toBe('gemini-3.8-flash');
});
test('defaults, disables, and validates ordered fallback choices', async () => {
  expect((await resolveRepairAiSelection('owner', {})).selection.fallbackModels).toEqual(['gemini-3.7-flash', 'gemini-3.6-flash']);
  expect((await resolveRepairAiSelection('owner', { fallbackModels: [] })).selection.fallbackModels).toEqual([]);
  expect((await resolveRepairAiSelection('owner', { fallbackModels: ['gemini-3.6-flash', 'gemini-3.5-flash'] })).selection.fallbackModels).toEqual(['gemini-3.6-flash', 'gemini-3.5-flash']);
  for (const fallbackModels of [['gemini-3.8-flash'], ['a', 'a'], ['a', 'b', 'c'], ['https://bad'], 'bad']) {
    await expect(resolveRepairAiSelection('owner', { fallbackModels: fallbackModels as string[] })).rejects.toThrow('fallback');
  }
});
test('honors explicit profile/model/key sources without silently replacing blank backup', async () => {
  const selected = await resolveRepairAiSelection('owner', { profileId: 'one', aiModel: 'chosen-model', primaryKeyRef: 'two:primary', backupKeyRef: '' });
  expect(selected.profile.id).toBe('one');
  expect(selected.primaryApiKey).toBe('fixture-other-3333');
  expect(selected.backupApiKey).toBe('');
  expect(selected.selection.aiModel).toBe('chosen-model');
  expect(mocks.read).toHaveBeenCalledWith('owner');
});
test('rejects unavailable profile/key references instead of falling back to another owner/profile', async () => {
  await expect(resolveRepairAiSelection('owner', { profileId: 'missing' })).rejects.toThrow('profile');
  await expect(resolveRepairAiSelection('owner', { primaryKeyRef: 'other-owner:primary' })).rejects.toThrow('key');
});
test('does not expose upstream URL or response text in unexpected failures', () => {
  expect(pronunciationRepairErrorMessage(new Error('https://example.invalid/?key=secret'))).not.toContain('secret');
});
