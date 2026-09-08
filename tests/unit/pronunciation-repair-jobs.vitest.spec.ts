import { beforeEach, expect, test, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ rows: [] as unknown[], running: true, updates: [] as Record<string, unknown>[], insert: vi.fn(), propose: vi.fn(), idle: vi.fn(), selection: vi.fn(), put: vi.fn() }));
vi.mock('@/lib/server/audiobooks/blobstore', () => ({ putAudiobookObject: (...args: unknown[]) => mocks.put(...args) }));
vi.mock('@/db', () => ({ db: {
  select: () => { const chain = { from: () => chain, where: () => chain, orderBy: async () => mocks.rows, limit: async () => mocks.rows }; return chain; },
  insert: () => ({ values: (...args: unknown[]) => mocks.insert(...args) }),
  update: () => ({ set: (values: Record<string, unknown>) => ({ where: () => {
    mocks.updates.push(structuredClone(values));
    return { returning: async () => mocks.running ? [{ id: 'job' }] : [], then: (resolve: (value: unknown) => unknown) => Promise.resolve().then(resolve) };
  } }) }),
} }));
vi.mock('@/lib/server/audiobooks/pronunciation-repairs', () => ({ proposePronunciationRepair: (...args: unknown[]) => mocks.propose(...args), assertPronunciationBookIdle: (...args: unknown[]) => mocks.idle(...args) }));
vi.mock('@/lib/server/audiobooks/pronunciation-repair-config', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/server/audiobooks/pronunciation-repair-config')>(), resolveRepairAiSelection: (...args: unknown[]) => mocks.selection(...args) }));
import { queuePronunciationRepairs, processPronunciationRepairJob } from '@/lib/server/audiobooks/pronunciation-repair-jobs';
import type { audiobookJobs } from '@/db/schema';
const chapters = [{ fileName: '0001__text.txt', hash: 'a'.repeat(64) }, { fileName: '0002__text.txt', hash: 'b'.repeat(64) }];
const settings = () => ({ jobType: 'pronunciation-repair', chapters, results: [], profileId: 'chosen', aiModel: 'gemini-3.8-flash', primaryKeyRef: 'other:primary', backupKeyRef: '' });
const job = () => ({ id: 'job', userId: 'owner', documentId: 'book', status: 'running', settingsJson: settings() }) as typeof audiobookJobs.$inferSelect;
beforeEach(() => {
  vi.clearAllMocks(); mocks.rows = []; mocks.running = true; mocks.updates = [];
  mocks.selection.mockResolvedValue({ selection: { profileId: 'chosen', aiModel: 'gemini-3.8-flash', primaryKeyRef: 'other:primary', backupKeyRef: '' }, primaryApiKey: 'fixture-never-persist', backupApiKey: '' });
});
test('persists selected work and references without calling Gemini or storing secrets', async () => {
  await queuePronunciationRepairs({ bookId: 'book', userId: 'owner', chapters, requestId: '12345678-1234-1234-1234-123456789abc', profileId: 'chosen' });
  expect(mocks.propose).not.toHaveBeenCalled();
  const saved = mocks.insert.mock.calls[0][0];
  expect(saved.settingsJson.chapters).toEqual(chapters);
  expect(saved.settingsJson.primaryKeyRef).toBe('other:primary');
  expect(JSON.stringify(saved)).not.toContain('fixture-never-persist');
});
test('continues after an individual failure and checkpoints successful proposals', async () => {
  mocks.propose.mockRejectedValueOnce(new Error('upstream secret')).mockResolvedValueOnce({ runId: 'run-two' });
  await processPronunciationRepairJob(job());
  expect(mocks.propose).toHaveBeenCalledTimes(2);
  expect(mocks.propose.mock.calls[1][0]).toMatchObject({ fileName: '0002__text.txt', profileId: 'chosen', aiModel: 'gemini-3.8-flash', ownJobId: 'job' });
  const checkpoint = mocks.updates.filter(update => update.settingsJson).at(-1)!.settingsJson as ReturnType<typeof settings>;
  expect(checkpoint.results).toHaveLength(2);
  expect(JSON.stringify(checkpoint)).not.toContain('upstream secret');
  expect(checkpoint.results[1]).toMatchObject({ runId: 'run-two' });
  expect(mocks.updates.at(-1)).toMatchObject({ status: 'error', progress: 100 });
});
test('resumes saved progress without repeating completed chapters', async () => {
  const resumed = job();
  resumed.settingsJson = { ...settings(), results: [{ fileName: chapters[0].fileName, runId: 'existing', requestId: 'previous' }] };
  mocks.propose.mockResolvedValue({ runId: 'second' });
  await processPronunciationRepairJob(resumed);
  expect(mocks.propose).toHaveBeenCalledTimes(1);
  expect(mocks.propose.mock.calls[0][0].fileName).toBe(chapters[1].fileName);
  expect(mocks.updates.at(-1)).toMatchObject({ status: 'completed' });
});
test('does no work after losing the running claim', async () => {
  mocks.running = false;
  await processPronunciationRepairJob(job());
  expect(mocks.propose).not.toHaveBeenCalled();
  expect(mocks.updates.some(update => update.status === 'completed')).toBe(false);
});
test('stores rejected diagnostics privately and checkpoints the report reference, not whole chapter data', async () => {
  mocks.propose.mockImplementation(async ({ onDiagnostics }) => {
    onDiagnostics({ version: 1, promptVersion: 1, stage: 'chapter-validation', validatorReason: 'Pronunciation issues remain.' });
    throw new Error('Rejected');
  });
  await processPronunciationRepairJob(job());
  expect(mocks.put).toHaveBeenCalledTimes(2);
  expect(mocks.put.mock.calls[0].slice(0, 2)).toEqual(['book', 'owner']);
  expect(mocks.put.mock.calls[0][2]).toMatch(/^pronunciation_repair_[a-f0-9-]+\.json$/);
  const stored = mocks.updates.filter(update => update.settingsJson).at(-1)!.settingsJson as { results: { diagnosticsFile: string }[] };
  expect(stored.results[0].diagnosticsFile).toBe(mocks.put.mock.calls[0][2]);
  expect(JSON.stringify(stored)).not.toContain('validatorReason');
});
test('retains the original chapter failure if diagnostic storage itself fails', async () => {
  mocks.put.mockRejectedValue(new Error('Storage unavailable'));
  mocks.propose.mockImplementation(async ({ onDiagnostics }) => { onDiagnostics({ version: 1, promptVersion: 1, stage: 'validation' }); throw new Error('Rejected'); });
  await processPronunciationRepairJob(job());
  const stored = mocks.updates.filter(update => update.settingsJson).at(-1)!.settingsJson as { results: { diagnosticsUnavailable: string }[] };
  expect(stored.results[0].diagnosticsUnavailable).toContain('Diagnostic storage failed');
});
