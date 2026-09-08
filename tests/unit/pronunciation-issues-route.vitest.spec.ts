import { beforeEach, expect, test, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ auth: vi.fn(), owned: vi.fn(), catalog: vi.fn(), chapter: vi.fn(), propose: vi.fn(), resume: vi.fn(), queue: vi.fn(), jobs: vi.fn(), stop: vi.fn(), config: vi.fn(), report: vi.fn() }));
vi.mock('@/lib/server/audiobooks/pronunciation-repair-report', () => ({ pronunciationRepairReport: (...args: unknown[]) => mocks.report(...args) }));
vi.mock('@/lib/server/audiobooks/pronunciation-repair-jobs', () => ({ queuePronunciationRepairs: (...args: unknown[]) => mocks.queue(...args), listPronunciationRepairJobs: (...args: unknown[]) => mocks.jobs(...args), stopPronunciationRepairs: (...args: unknown[]) => mocks.stop(...args) }));
vi.mock('@/lib/server/audiobooks/pronunciation-repair-config', () => ({ loadPronunciationRepairConfig: (...args: unknown[]) => mocks.config(...args), pronunciationRepairErrorMessage: () => 'Repair failed safely.' }));
vi.mock('@/lib/server/auth/auth', () => ({ requireAuthContext: (...args: unknown[]) => mocks.auth(...args) }));
vi.mock('@/db', () => ({ db: { select: () => ({ from: () => ({ where: () => ({ limit: () => mocks.owned() }) }) }) } }));
vi.mock('@/lib/server/audiobooks/pronunciation-repairs', () => ({
  pronunciationCatalog: (...args: unknown[]) => mocks.catalog(...args),
  readPronunciationChapter: (...args: unknown[]) => mocks.chapter(...args),
  proposePronunciationRepair: (...args: unknown[]) => mocks.propose(...args),
  resumeRepairedPronunciationJob: (...args: unknown[]) => mocks.resume(...args),
  pronunciationDictionary: async () => ({ dictionary: {} }), existingPronunciationRepair: async () => null,
}));
vi.mock('@/lib/server/tasks/engine', () => ({ runTaskNow: vi.fn().mockResolvedValue(undefined) }));
import { GET, POST } from '../../src/app/api/audiobooks/pronunciation-issues/route';
const request = (action: string) => new Request('http://localhost/api/audiobooks/pronunciation-issues', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ bookId: 'book', fileName: '0001__text.txt', action, hash: 'hash' }) });
beforeEach(() => { vi.clearAllMocks(); mocks.auth.mockResolvedValue({ userId: 'owner' }); mocks.owned.mockResolvedValue([{ id: 'book' }]); });

test('denies unauthenticated scans without accessing book data', async () => {
  mocks.auth.mockResolvedValue(new Response('Unauthorized', { status: 401 }));
  expect((await GET(new Request('http://localhost/api/audiobooks/pronunciation-issues?bookId=book'))).status).toBe(401);
  expect(mocks.catalog).not.toHaveBeenCalled();
});
test('denies every mutation for another owner’s book', async () => {
  mocks.owned.mockResolvedValue([]);
  for (const action of ['scan', 'propose', 'resume', 'queue', 'stop']) expect((await POST(request(action))).status).toBe(404);
  expect(mocks.chapter).not.toHaveBeenCalled(); expect(mocks.propose).not.toHaveBeenCalled(); expect(mocks.resume).not.toHaveBeenCalled();
});
test('queues work without waiting for Gemini and honors request-only configuration', async () => {
  mocks.queue.mockResolvedValue({ jobId: 'job' });
  const response = await POST(new Request('http://localhost/api/audiobooks/pronunciation-issues', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
    bookId: 'book', action: 'queue', requestId: 'request', profileId: 'chosen', aiModel: 'gemini-3.8-flash', primaryKeyRef: 'second:primary', backupKeyRef: '', chapters: [],
  }) }));
  expect(response.status).toBe(202);
  expect(mocks.queue).toHaveBeenCalledWith(expect.objectContaining({ userId: 'owner', profileId: 'chosen', aiModel: 'gemini-3.8-flash', primaryKeyRef: 'second:primary', backupKeyRef: '' }));
  expect(mocks.propose).not.toHaveBeenCalled();
});
test('provides a safe diagnostic reference instead of echoing unknown upstream errors', async () => {
  mocks.queue.mockRejectedValue(new Error('https://upstream.invalid/?key=fixture-secret'));
  const response = await POST(request('queue'));
  const body = await response.json();
  expect(body.requestId).toMatch(/^[a-f0-9-]+$/);
  expect(JSON.stringify(body)).not.toContain('fixture-secret');
});
test('downloads reports only within the authenticated book ownership scope', async () => {
  const id = 'ce5c61c4-5aa6-4d6f-9f3b-469543d2e321';
  const url = `http://localhost/api/audiobooks/pronunciation-issues?bookId=book&action=report&jobId=${id}`;
  mocks.owned.mockResolvedValue([]);
  expect((await GET(new Request(url))).status).toBe(404);
  expect(mocks.report).not.toHaveBeenCalled();
  mocks.owned.mockResolvedValue([{ id: 'book' }]);
  mocks.report.mockResolvedValue({ jobId: id, summary: { failures: 42 } });
  const response = await GET(new Request(url));
  expect(mocks.report).toHaveBeenCalledWith('book', 'owner', id);
  expect(response.headers.get('Content-Disposition')).toContain('attachment;');
  expect(response.headers.get('Cache-Control')).toContain('no-store');
  expect((await response.json()).summary.failures).toBe(42);
});
test('uses the authenticated owner and exposes no original source in scan results', async () => {
  mocks.chapter.mockResolvedValue({ text: 'שלום', original: 'private source context', chapterIndex: 0, hash: 'hash', title: 'Chapter', failed: false });
  const response = await POST(request('scan'));
  expect(response.status).toBe(200);
  expect(mocks.chapter).toHaveBeenCalledWith('book', 'owner', '0001__text.txt');
  const body = await response.json();
  expect(body.issues).toHaveLength(1); expect(body.original).toBeUndefined();
});
