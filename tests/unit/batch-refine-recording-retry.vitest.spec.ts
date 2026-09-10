import { beforeEach, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ rows: [] as unknown[][], update: vi.fn(), set: vi.fn(), where: vi.fn() }));
vi.mock('@/db', () => ({ db: {
  select: () => {
    const rows = mocks.rows.shift() || [];
    const query = { from: () => query, innerJoin: () => query, where: () => query,
      limit: async () => rows, then: (resolve: (value: unknown[]) => unknown) => Promise.resolve(rows).then(resolve) };
    return query;
  },
  update: mocks.update,
} }));
vi.mock('@/lib/server/audiobooks/blobstore', () => ({ getAudiobookObjectBuffer: vi.fn(), listAudiobookObjects: vi.fn(), putAudiobookObject: vi.fn() }));
vi.mock('@/lib/server/audiobooks/pronunciation-repair-validation', () => ({ assertStoredPronunciationRepair: vi.fn() }));
import { retryBatchRefineRecording } from '@/lib/server/audiobooks/batch-refine-review-store';

beforeEach(() => {
  vi.clearAllMocks(); mocks.rows = [];
  mocks.update.mockReturnValue({ set: mocks.set });
  mocks.set.mockReturnValue({ where: mocks.where });
  mocks.where.mockResolvedValue(undefined);
});
const owned = (decision = 'approved', audioStatus = 'error') => [{ change: { documentId: 'book', decision, audioStatus }, run: {} }];

test.each(['running', 'queued', 'pausing'])('blocks retry while book job is %s without changing recording', async status => {
  mocks.rows = [owned(), [{ status }]];
  await expect(retryBatchRefineRecording('change', 'owner')).rejects.toThrow('Pause background');
  expect(mocks.update).not.toHaveBeenCalled();
});
test.each([['pending', 'error'], ['approved', 'completed'], ['approved', 'queued']])('rejects ineligible %s/%s recording', async (decision, status) => {
  mocks.rows = [owned(decision, status)];
  await expect(retryBatchRefineRecording('change', 'owner')).rejects.toThrow('Only failed approved');
  expect(mocks.update).not.toHaveBeenCalled();
});
test('rejects missing or unowned change', async () => {
  await expect(retryBatchRefineRecording('change', 'other')).rejects.toThrow('not found');
  expect(mocks.update).not.toHaveBeenCalled();
});
test('requeues approved failed audio with the explicitly selected voice', async () => {
  mocks.rows = [owned(), [{ status: 'completed' }]];
  await retryBatchRefineRecording('change', 'owner', 'af_heart');
  expect(mocks.set).toHaveBeenCalledWith({ audioStatus: 'queued', audioError: null, reviewNote: '[Recording voice=af_heart]', updatedAt: expect.any(Number) });
});
