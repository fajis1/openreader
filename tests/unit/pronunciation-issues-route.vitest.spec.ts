import { beforeEach, expect, test, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ auth: vi.fn(), owned: vi.fn(), catalog: vi.fn(), chapter: vi.fn(), propose: vi.fn(), resume: vi.fn(), queue: vi.fn(), jobs: vi.fn(), stop: vi.fn(), config: vi.fn(), report: vi.fn(), repairStatus: vi.fn(), remember: vi.fn() }));
vi.mock('@/lib/server/audiobooks/remember-approved-pronunciations', () => ({ rememberApprovedPronunciations: (...args: unknown[]) => mocks.remember(...args) }));
vi.mock('@/lib/server/audiobooks/pronunciation-repair-status', () => ({ listPronunciationRepairStatus: (...args: unknown[]) => mocks.repairStatus(...args) }));
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

test('loads live repair status only for the authenticated book owner', async () => {
  const url = 'http://localhost/api/audiobooks/pronunciation-issues?bookId=book&action=review-status';
  mocks.owned.mockResolvedValue([]);
  expect((await GET(new Request(url))).status).toBe(404);
  expect(mocks.repairStatus).not.toHaveBeenCalled();
  mocks.owned.mockResolvedValue([{ id: 'book' }]);
  mocks.repairStatus.mockResolvedValue([{ changeId: 'change', decision: 'approved', audioStatus: 'completed' }]);
  const response = await GET(new Request(url));
  expect(mocks.repairStatus).toHaveBeenCalledWith('book', 'owner');
  expect((await response.json()).repairs[0].audioStatus).toBe('completed');
});

test('denies unauthenticated scans without accessing book data', async () => {
  mocks.auth.mockResolvedValue(new Response('Unauthorized', { status: 401 }));
  expect((await GET(new Request('http://localhost/api/audiobooks/pronunciation-issues?bookId=book'))).status).toBe(401);
  expect(mocks.catalog).not.toHaveBeenCalled();
});
test('denies every mutation for another owner’s book', async () => {
  mocks.owned.mockResolvedValue([]);
  for (const action of ['scan', 'propose', 'resume', 'queue', 'stop', 'remember-approved']) expect((await POST(request(action))).status).toBe(404);
  expect(mocks.remember).not.toHaveBeenCalled();
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

test('returns an editable review region when TTS failed but pronunciation scanning is clean', async () => {
  mocks.chapter.mockResolvedValue({ text: 'Plain narration.', original: 'Plain narration.', chapterIndex: 3, hash: 'hash', title: 'Chapter 4', failed: true, failureError: 'TTS recording failed.' });
  const response = await POST(request('scan'));
  const body = await response.json();
  expect(body.failed).toBe(true);
  expect(body.issues).toMatchObject([{ id: 'failed-chapter', text: 'Plain narration.', replacement: 'Plain narration.', reason: 'TTS recording failed.' }]);
});

test('remembers approved repairs only for the authenticated owner without accepting client pronunciations', async () => {
  mocks.remember.mockResolvedValue({ saved: 2, alreadyKnown: 0, skipped: 1 });
  const response = await POST(request('remember-approved'));
  expect(response.status).toBe(200);
  expect(mocks.remember).toHaveBeenCalledWith('book', 'owner');
  expect((await response.json()).saved).toBe(2);
  expect(mocks.queue).not.toHaveBeenCalled();
});
