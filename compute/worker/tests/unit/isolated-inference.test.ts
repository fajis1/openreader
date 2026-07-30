import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, test, vi } from 'vitest';

class FakeChild extends EventEmitter {
  connected = true;
  killed = false;
  send = vi.fn();
  disconnect = vi.fn(() => {
    this.connected = false;
  });
  kill = vi.fn(() => {
    this.killed = true;
    return true;
  });
}

const childState = vi.hoisted(() => ({ current: null as FakeChild | null }));
vi.mock('node:child_process', () => ({
  fork: vi.fn(() => childState.current),
}));

afterEach(() => {
  childState.current = null;
});

describe('isolated inference', () => {
  test('waits for ordered progress persistence before resolving a result', async () => {
    const child = new FakeChild();
    childState.current = child;
    let finishProgress!: () => void;
    const progressPersistence = new Promise<void>((resolve) => {
      finishProgress = resolve;
    });
    const { startIsolatedInference } = await import('../../src/isolated-inference');
    const inference = startIsolatedInference<{ parsed: string }>({
      request: {
        kind: 'pdf-layout',
        documentId: 'doc-1',
        pdfBytes: new ArrayBuffer(0),
      },
      onPageParsed: () => progressPersistence,
    });
    let resolved = false;
    void inference.promise.then(() => {
      resolved = true;
    });
    const requestId = child.send.mock.calls[0]![0].requestId as string;

    child.emit('message', {
      requestId,
      type: 'page-parsed',
      pageNumber: 1,
      totalPages: 1,
      pageMs: 10,
    });
    child.emit('message', { requestId, type: 'result', result: { parsed: 'done' } });
    await Promise.resolve();
    expect(resolved).toBe(false);

    finishProgress();
    await expect(inference.promise).resolves.toEqual({ parsed: 'done' });
    expect(child.disconnect).toHaveBeenCalledOnce();
  });

  test('terminates native work when a progress handler fails', async () => {
    const child = new FakeChild();
    childState.current = child;
    const { startIsolatedInference } = await import('../../src/isolated-inference');
    const inference = startIsolatedInference({
      request: {
        kind: 'pdf-layout',
        documentId: 'doc-2',
        pdfBytes: new ArrayBuffer(0),
      },
      onPageStarted: async () => {
        throw new Error('progress persistence failed');
      },
    });
    const requestId = child.send.mock.calls[0]![0].requestId as string;

    child.emit('message', { requestId, type: 'page-started', pageNumber: 1, totalPages: 2 });
    await expect(inference.promise).rejects.toThrow('progress persistence failed');
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
  });
});
