import { EventEmitter } from 'node:events';
import { fork } from 'node:child_process';
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

  test('forces a fresh CPU-only child for an OOM fallback attempt', async () => {
    const child = new FakeChild();
    childState.current = child;
    const { startIsolatedInference } = await import('../../src/isolated-inference');
    startIsolatedInference({
      request: {
        kind: 'pdf-layout',
        documentId: 'doc-cpu-retry',
        pdfBytes: new ArrayBuffer(0),
      },
      reuseProcess: true,
      providerOverride: 'cpu',
    });

    expect(vi.mocked(fork)).toHaveBeenLastCalledWith(
      expect.any(String),
      [],
      expect.objectContaining({
        env: expect.objectContaining({
          COMPUTE_ONNX_EXECUTION_PROVIDER: 'cpu',
          PDF_LAYOUT_ONNX_EXECUTION_PROVIDER: 'cpu',
          WHISPER_ONNX_EXECUTION_PROVIDER: 'cpu',
        }),
      }),
    );
  });

  test('recognizes CUDA allocation failures without treating generic OOM as CUDA', async () => {
    const { isCudaOutOfMemoryError } = await import('../../src/isolated-inference');

    expect(isCudaOutOfMemoryError(new Error('CUDA_ERROR_OUT_OF_MEMORY'))).toBe(true);
    expect(isCudaOutOfMemoryError(new Error('CUDNN_STATUS_ALLOC_FAILED'))).toBe(true);
    expect(isCudaOutOfMemoryError(new Error('JavaScript heap out of memory'))).toBe(false);
  });

  test('does not settle termination until the native child has exited', async () => {
    const child = new FakeChild();
    childState.current = child;
    const { startIsolatedInference } = await import('../../src/isolated-inference');
    const inference = startIsolatedInference({
      request: {
        kind: 'pdf-layout',
        documentId: 'doc-termination',
        pdfBytes: new ArrayBuffer(0),
      },
      reuseProcess: true,
    });
    const inferenceFailure = expect(inference.promise).rejects.toThrow(
      'Isolated ONNX inference was terminated after timeout.',
    );
    let terminated = false;
    const termination = inference.terminate().then(() => {
      terminated = true;
    });

    await Promise.resolve();
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
    expect(terminated).toBe(false);

    child.emit('exit', null, 'SIGKILL');
    await termination;
    await inferenceFailure;
    expect(terminated).toBe(true);
  });
});
