import { beforeEach, expect, test, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ auth: vi.fn(), owned: vi.fn(), catalog: vi.fn(), chapter: vi.fn(), propose: vi.fn(), resume: vi.fn() }));
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
  for (const action of ['scan', 'propose', 'resume']) expect((await POST(request(action))).status).toBe(404);
  expect(mocks.chapter).not.toHaveBeenCalled(); expect(mocks.propose).not.toHaveBeenCalled(); expect(mocks.resume).not.toHaveBeenCalled();
});
test('uses the authenticated owner and exposes no original source in scan results', async () => {
  mocks.chapter.mockResolvedValue({ text: 'שלום', original: 'private source context', chapterIndex: 0, hash: 'hash', title: 'Chapter', failed: false });
  const response = await POST(request('scan'));
  expect(response.status).toBe(200);
  expect(mocks.chapter).toHaveBeenCalledWith('book', 'owner', '0001__text.txt');
  const body = await response.json();
  expect(body.issues).toHaveLength(1); expect(body.original).toBeUndefined();
});
