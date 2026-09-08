import { beforeEach, expect, test, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ rows: [] as unknown[], get: vi.fn(), head: vi.fn() }));
vi.mock('@/db', () => ({ db: { select: () => ({ from: () => ({ where: () => ({ limit: async () => mocks.rows }) }) }) } }));
vi.mock('@/lib/server/audiobooks/blobstore', () => ({ getAudiobookObjectBuffer: (...args: unknown[]) => mocks.get(...args), headAudiobookObject: (...args: unknown[]) => mocks.head(...args) }));
import { pronunciationRepairReport } from '@/lib/server/audiobooks/pronunciation-repair-report';
const id = 'ce5c61c4-5aa6-4d6f-9f3b-469543d2e321';
beforeEach(() => { vi.clearAllMocks(); mocks.rows = []; mocks.head.mockResolvedValue({ contentLength: 1000 }); });
test('exports all legacy failures without inventing discarded diagnostics', async () => {
  mocks.rows = [{ id, status: 'error', progress: 100, settingsJson: { jobType: 'pronunciation-repair', chapters: Array(48).fill({}), results: [
    ...Array.from({ length: 42 }, (_, index) => ({ fileName: `${index + 1}__text.txt`, requestId: `req-${index}`, error: index < 35 ? 'Validation failed' : 'Missing patches' })),
    ...Array.from({ length: 6 }, (_, index) => ({ fileName: `${index + 50}__text.txt`, runId: `run-${index}` })),
  ] } }];
  const report = await pronunciationRepairReport('book', 'owner', id);
  expect(report?.summary).toMatchObject({ selectedChapters: 48, proposals: 6, failures: 42, failureReasons: { 'Validation failed': 35, 'Missing patches': 7 } });
  expect(report?.chapters).toHaveLength(48);
  expect(report?.chapters[0].diagnosticsUnavailable).toContain('Not retained');
  expect(mocks.get).not.toHaveBeenCalled();
});
test('loads captured detail using the owned book scope and degrades gracefully if missing', async () => {
  const file = `pronunciation_repair_${id}.json`;
  mocks.rows = [{ id, settingsJson: { jobType: 'pronunciation-repair', chapters: [{}], results: [{ fileName: '0001__text.txt', error: 'Validation failed', diagnosticsFile: file }] } }];
  mocks.get.mockResolvedValue(Buffer.from(JSON.stringify({ version: 1, promptVersion: 1, stage: 'chapter-validation', validatorReason: 'Repair changed surrounding chapter text.' })));
  const report = await pronunciationRepairReport('book', 'owner', id);
  expect(mocks.get).toHaveBeenCalledWith('book', 'owner', file, null);
  expect(report?.chapters[0].diagnostics?.validatorReason).toBe('Repair changed surrounding chapter text.');
  mocks.get.mockRejectedValue(new Error('Missing'));
  expect((await pronunciationRepairReport('book', 'owner', id))?.chapters[0].diagnosticsUnavailable).toContain('could not be read');
});
test('refuses missing jobs and never reads a forged diagnostic path', async () => {
  expect(await pronunciationRepairReport('book', 'owner', id)).toBeNull();
  mocks.rows = [{ id, settingsJson: { jobType: 'pronunciation-repair', results: [{ fileName: '0001__text.txt', error: 'failed', diagnosticsFile: '../private' }] } }];
  await pronunciationRepairReport('book', 'owner', id);
  expect(mocks.get).not.toHaveBeenCalled();
});
