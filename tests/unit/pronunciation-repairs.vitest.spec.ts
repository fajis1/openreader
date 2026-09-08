import { beforeEach, describe, expect, test, vi } from 'vitest';
import { batchRefineTextHash } from '../../src/lib/server/audiobooks/batch-refine-assessment';

const mocks = vi.hoisted(() => ({
  objects: new Map<string, string>(), selectResults: [] as unknown[][],
  profile: { id: 'profile', name: 'Standard', workerMode: 'standard', pronunciations: {} as Record<string, string>, geminiApiKey: 'fixture' },
  createRun: vi.fn(), insert: vi.fn(), finish: vi.fn(), put: vi.fn(), gemini: vi.fn(), fetch: vi.fn(),
}));
vi.mock('@/db', () => ({ db: { select: () => {
  const rows = mocks.selectResults.shift() || [];
  const chain = { from: () => chain, innerJoin: () => chain, where: () => chain, orderBy: () => chain, limit: async () => rows,
    then: (resolve: (value: unknown[]) => unknown) => Promise.resolve(rows).then(resolve) };
  return chain;
} } }));
vi.mock('@/lib/server/audiobooks/blobstore', () => ({
  headAudiobookObject: async (_book: string, _user: string, file: string) => {
    if (!mocks.objects.has(file)) throw Object.assign(new Error('Not found'), { name: 'NoSuchKey' });
    return { contentLength: Buffer.byteLength(mocks.objects.get(file)!) };
  },
  isMissingBlobError: (error: Error) => error.name === 'NoSuchKey',
  listAudiobookObjects: async () => [...mocks.objects].map(([fileName, text]) => ({ fileName, size: Buffer.byteLength(text), lastModified: 1 })),
  getAudiobookObjectBuffer: async (_book: string, _user: string, file: string) => {
    if (!mocks.objects.has(file)) throw new Error('Not found');
    return Buffer.from(mocks.objects.get(file)!);
  },
  putAudiobookObject: (...args: unknown[]) => mocks.put(...args),
}));
vi.mock('@/lib/server/audiobooks/batch-refine-review-store', () => ({
  createBatchRefineRun: (...args: unknown[]) => mocks.createRun(...args),
  insertBatchRefineProposal: (...args: unknown[]) => mocks.insert(...args),
  finishBatchRefineRun: (...args: unknown[]) => mocks.finish(...args),
  updateBatchRefineRunProgress: vi.fn(), markBatchRefineRunStarted: vi.fn(),
}));
vi.mock('@/lib/server/smart-audio-profiles', () => ({ readSmartAudioProfilesDocument: async () => ({ selectedProfileId: 'profile', profiles: [mocks.profile] }), findSmartAudioProfileById: () => mocks.profile }));
vi.mock('@/lib/server/smart-audio/book-lexicon', () => ({ readBookLexicon: async () => null }));
vi.mock('@/lib/server/smart-audio/gemini-failover', () => ({ fetchGeminiWithRateLimitFallback: (...args: unknown[]) => mocks.gemini(...args) }));

import { pronunciationCatalog, proposePronunciationRepair, readPronunciationChapter, resumeRepairedPronunciationJob } from '../../src/lib/server/audiobooks/pronunciation-repairs';
import { savePronunciationFailure } from '../../src/lib/server/audiobooks/pronunciation-failures';

const base = { bookId: 'book', userId: 'user', fileName: '0107__text.txt', signal: new AbortController().signal };
function seed(text: string) {
  mocks.objects.set(base.fileName, text);
  mocks.objects.set('0107__original.txt', 'Original source context.');
  return { ...base, hash: batchRefineTextHash(text) };
}

beforeEach(() => {
  vi.clearAllMocks(); mocks.objects.clear(); mocks.selectResults = []; mocks.profile.pronunciations = {};
  vi.stubGlobal('fetch', mocks.fetch);
  mocks.gemini.mockImplementation(async ({ request }) => ({ response: await request('fixture', 'fixture-model') }));
});

describe('pronunciation repair service', () => {
  test('uses a dictionary repair without Gemini and stores a proposal, never canonical text', async () => {
    mocks.profile.pronunciations = { Aetherian: '/eɪθɪriən/' };
    const result = await proposePronunciationRepair(seed('The [Aetherian](/bad split/) arrived.'));
    expect(result.dictionaryRepairs).toBe(1);
    expect(mocks.gemini).not.toHaveBeenCalled();
    expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({ previousText: 'The [Aetherian](/bad split/) arrived.', proposedText: 'The [Aetherian](/eɪθɪriən/) arrived.' }));
    expect(mocks.put.mock.calls.every(call => String(call[2]).endsWith('.diff'))).toBe(true);
  });

  test('sends only the affected chapter and original context; applies returned patches', async () => {
    const input = seed('God θεοῦ.'); mocks.objects.set('0108__text.txt', 'UNRELATED CHAPTER');
    mocks.fetch.mockResolvedValue(new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ patches: [{ id: '0', replacement: '[θεοῦ](/θɛu/)' }] }) }] } }] })));
    await proposePronunciationRepair(input);
    const payload = JSON.parse(mocks.fetch.mock.calls[0][1].body);
    const context = JSON.parse(payload.contents[0].parts[0].text);
    expect(context.originalSource).toBe('Original source context.');
    expect(context.chapterContext).toBe('God θεοῦ.');
    expect(JSON.stringify(payload)).not.toContain('UNRELATED CHAPTER');
    expect(mocks.insert.mock.calls[0][0].proposedText).toBe('God [θεοῦ](/θɛu/).');
  });

  test('rejects stale scans, active jobs, and healthy chapters without invoking Gemini', async () => {
    const input = seed('God θεοῦ.');
    await expect(proposePronunciationRepair({ ...input, hash: 'stale' })).rejects.toThrow('changed');
    mocks.selectResults = [[{ id: 'active' }]];
    await expect(proposePronunciationRepair(input)).rejects.toThrow('Pause');
    await expect(proposePronunciationRepair(seed('Healthy chapter.'))).rejects.toThrow('No pronunciation');
    expect(mocks.gemini).not.toHaveBeenCalled(); expect(mocks.createRun).not.toHaveBeenCalled();
  });

  test('requires complete valid patches and rejects English rewrite attempts before saving', async () => {
    const input = seed('The [Aetherian](/bad split/) arrived.');
    mocks.fetch.mockResolvedValue(new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ patches: [{ id: '0', replacement: 'Someone else' }] }) }] } }] })));
    await expect(proposePronunciationRepair(input)).rejects.toThrow('unchanged-text validation');
    expect(mocks.createRun).not.toHaveBeenCalled();
  });

  test('allows a manual targeted replacement without an AI request', async () => {
    const input = seed('God θεοῦ.');
    await proposePronunciationRepair({ ...input, manualPatches: [{ id: '0', replacement: '[θεοῦ](/θɛu/)' }] });
    expect(mocks.gemini).not.toHaveBeenCalled();
  });

  test('reports non-JSON Gemini output without echoing its body', async () => {
    mocks.fetch.mockResolvedValue(new Response('<html>private upstream body</html>'));
    await expect(proposePronunciationRepair(seed('God θεοῦ.'))).rejects.toThrow('Gemini returned invalid JSON');
    expect(mocks.createRun).not.toHaveBeenCalled();
  });

  test('stops before saving if cancelled', async () => {
    const input = seed('God θεοῦ.');
    const controller = new AbortController();
    controller.abort();
    await expect(proposePronunciationRepair({ ...input, signal: controller.signal })).rejects.toThrow();
    expect(mocks.gemini).not.toHaveBeenCalled();
    expect(mocks.createRun).not.toHaveBeenCalled();
  });

  test('honors a requested model and key references for Gemini repairs', async () => {
    mocks.fetch.mockResolvedValue(Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify({ patches: [{ id: '0', replacement: '[θεοῦ](/θɛu/)' }] }) }] } }] }));
    await proposePronunciationRepair({ ...seed('God θεοῦ.'), profileId: 'profile', aiModel: 'custom-selected-model', primaryKeyRef: 'profile:primary', backupKeyRef: '' });
    expect(mocks.gemini).toHaveBeenCalledWith(expect.objectContaining({ requestedModel: 'custom-selected-model', primaryApiKey: 'fixture', backupApiKey: '', maxAttempts: 3, signal: expect.any(AbortSignal) }));
  });

  test('retains exact validator and per-finding reasons for rejected replacements', async () => {
    const onDiagnostics = vi.fn();
    mocks.fetch.mockResolvedValue(Response.json({ responseId: 'response-fixture', candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify({ patches: [{ id: '0', replacement: 'Someone else' }] }) }] } }] }));
    await expect(proposePronunciationRepair({ ...seed('The [Aetherian](/bad split/) arrived.'), onDiagnostics })).rejects.toThrow('unchanged-text');
    const details = onDiagnostics.mock.calls[0][0];
    expect(details).toMatchObject({ stage: 'patch-application', validatorReason: 'Repair changed unrelated English text.', finishReason: 'STOP', httpStatus: 200 });
    expect(details.findings[0]).toMatchObject({ id: '0', original: '[Aetherian](/bad split/)', replacement: 'Someone else' });
    expect(details.systemInstruction).toContain('Preserve all English words and numbers.');
    expect(mocks.createRun).not.toHaveBeenCalled();
  });

  test('retains omitted finding IDs and supplied patches when Gemini returns an incomplete set', async () => {
    const onDiagnostics = vi.fn();
    mocks.fetch.mockResolvedValue(Response.json({ candidates: [{ content: { parts: [{ text: '{"patches":[]}' }] } }] }));
    await expect(proposePronunciationRepair({ ...seed('God θεοῦ.'), onDiagnostics })).rejects.toThrow('every finding');
    expect(onDiagnostics.mock.calls[0][0]).toMatchObject({ stage: 'patch-coverage', missingIds: ['0'], findings: [{ id: '0', original: 'θεοῦ', reasons: ['No replacement returned for this finding.'] }] });
  });

  test('restores an existing proposal and avoids another paid request', async () => {
    const input = seed('God θεοῦ.');
    mocks.selectResults = [[], [{ runId: 'existing', decision: 'pending', audioStatus: 'not_requested' }]];
    expect((await proposePronunciationRepair(input)).runId).toBe('existing');
    expect(mocks.gemini).not.toHaveBeenCalled(); expect(mocks.createRun).not.toHaveBeenCalled();
  });

  test('finds canonical and rejected chapter files, excluding originals and unrelated blobs', async () => {
    seed('God θεοῦ.'); mocks.objects.set('0108__rejected.txt', 'Broken'); mocks.objects.set('complete.m4b', 'audio');
    expect((await pronunciationCatalog('book', 'user')).chapters.map(row => row.fileName)).toEqual(['0107__text.txt', '0108__rejected.txt']);
    await expect(readPronunciationChapter('book', 'user', '../other.txt')).rejects.toThrow('Invalid');
  });

  test('retains Audio Drama voices and failed text separately from approved text', async () => {
    mocks.objects.set('0107__text.txt', 'Previous recording text.');
    await savePronunciationFailure({ bookId: 'book', userId: 'user', chapterIndex: 106, chapterTitle: 'Failed', sourceText: 'The Aetherian.', jobId: 'job', errors: ['alignment'],
      cast: [{ name: 'Narrator', voiceId: 'af_bella', aliases: [] }],
      rejected: { status: 'success', segments: [{ speaker: 'Narrator', text: 'The [Aetherian](/bad split/).' }] },
    });
    expect(mocks.put.mock.calls.map(call => call[2])).toEqual(['0107__rejected.txt', '0107__pronunciation_failure.json']);
    expect(mocks.put.mock.calls[0][3].toString()).toBe('<voice name="af_bella">The [Aetherian](/bad split/).</voice>');
    const metadata = JSON.parse(mocks.put.mock.calls[1][3].toString());
    expect(metadata.canonicalHash).toBe(batchRefineTextHash('Previous recording text.'));
    expect(metadata.sourceText).toBe('The Aetherian.');
  });

  test('refuses to resume until the approved replacement is recorded', async () => {
    const rejected = 'God θεοῦ.';
    mocks.objects.set('0107__rejected.txt', rejected);
    mocks.objects.set('0107__pronunciation_failure.json', JSON.stringify({ rejectedHash: batchRefineTextHash(rejected), sourceText: rejected, jobId: 'job' }));
    await expect(resumeRepairedPronunciationJob('book', 'user', '0107__rejected.txt')).rejects.toThrow('wait for its recording');
  });
});
