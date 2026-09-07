import { beforeEach, expect, test, vi } from 'vitest';
import { batchRefineTextHash } from '../../src/lib/server/audiobooks/batch-refine-assessment';
const mocks = vi.hoisted(() => ({ rows: [] as unknown[][], objects: new Map<string, string>(), put: vi.fn(), update: vi.fn() }));
vi.mock('@/db', () => ({ db: {
  select: () => {
    const rows = mocks.rows.shift() || [];
    const query = { from: () => query, innerJoin: () => query, where: () => query, limit: async () => rows,
      then: (resolve: (rows: unknown[]) => unknown) => Promise.resolve(rows).then(resolve) };
    return query;
  },
  update: () => ({ set: (value: unknown) => { mocks.update(value); return { where: async () => [] }; } }),
} }));
vi.mock('@/lib/server/audiobooks/blobstore', () => ({
  getAudiobookObjectBuffer: async (_book: string, _user: string, file: string) => {
    if (!mocks.objects.has(file)) throw new Error('Missing fixture');
    return Buffer.from(mocks.objects.get(file)!);
  },
  listAudiobookObjects: async () => [...mocks.objects.keys()].map(fileName => ({ fileName })),
  putAudiobookObject: (...args: unknown[]) => mocks.put(...args),
}));
import { approveBatchRefineChange } from '../../src/lib/server/audiobooks/batch-refine-review-store';
const previous = 'The [Aetherian](/bad split/) arrived.';
const proposed = 'The [Aetherian](/eɪθɪriən/) arrived.';
function owned(fileName = '0107__text.txt') {
  return { run: { id: 'run', rule: 'pronunciation-repair:v1', profileCategory: 'standard' }, change: {
    id: 'change', userId: 'user', documentId: 'book', decision: 'pending', audioStatus: 'not_requested',
    fileName, textFileName: fileName, previousText: previous, proposedText: proposed,
    sourceTextHash: batchRefineTextHash(previous), proposedTextHash: batchRefineTextHash(proposed),
    flagsJson: [], reviewPriority: 'high', reviewNote: 'repair',
  } };
}
beforeEach(() => { vi.clearAllMocks(); mocks.rows = []; mocks.objects.clear(); });
test('approving a failed output writes the canonical chapter, not the rejected snapshot', async () => {
  mocks.rows = [[owned('0107__rejected.txt')], []];
  mocks.objects.set('0107__rejected.txt', previous);
  mocks.objects.set('0107__pronunciation_failure.json', JSON.stringify({ rejectedHash: batchRefineTextHash(previous), canonicalHash: null }));
  expect(await approveBatchRefineChange({ changeId: 'change', userId: 'user' })).toEqual({ changeId: 'change', queued: true });
  expect(mocks.put).toHaveBeenCalledWith('book', 'user', '0107__text.txt', Buffer.from(proposed), expect.any(String), null);
  expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ decision: 'approved', audioStatus: 'queued' }));
});
test('rejects edits outside the flagged region before writing text or queueing audio', async () => {
  mocks.rows = [[owned()], []];
  await expect(approveBatchRefineChange({ changeId: 'change', userId: 'user', editedText: proposed.replace('arrived', 'departed') })).rejects.toThrow();
  expect(mocks.put).not.toHaveBeenCalled(); expect(mocks.update).not.toHaveBeenCalled();
});
test('protects a canonical chapter changed after failed generation', async () => {
  mocks.rows = [[owned('0107__rejected.txt')], []];
  mocks.objects.set('0107__rejected.txt', previous);
  mocks.objects.set('0107__text.txt', 'A newer manual edit.');
  mocks.objects.set('0107__pronunciation_failure.json', JSON.stringify({ rejectedHash: batchRefineTextHash(previous), canonicalHash: null }));
  await expect(approveBatchRefineChange({ changeId: 'change', userId: 'user' })).rejects.toThrow('saved chapter changed');
  expect(mocks.put).not.toHaveBeenCalled();
});
test('blocks approval while background generation is active', async () => {
  mocks.rows = [[owned()], [{ status: 'running' }]];
  await expect(approveBatchRefineChange({ changeId: 'change', userId: 'user' })).rejects.toThrow('Pause');
  expect(mocks.put).not.toHaveBeenCalled();
});
