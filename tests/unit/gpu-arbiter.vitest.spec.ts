import { afterEach, describe, expect, test, vi } from 'vitest';

import {
  getGpuArbiterConfig,
  parseGpuArbiterStatus,
  runWithGpuQueueStatus,
  type GpuArbiterConfig,
} from '../../src/lib/server/tts/gpu-arbiter';

const testConfig: GpuArbiterConfig = {
  statusUrl: 'http://gpu-arbiter.test/gpu/status',
  pollIntervalMs: 1_000,
  requestTimeoutMs: 2_000,
};

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('GPU arbiter status parsing and configuration', () => {
  test.each([
    'available',
    'waiting_for_qwen',
    'starting_kokoro',
    'qwen_active',
    'kokoro_active',
    'unknown',
  ] as const)('parses the %s state without requiring optional fields', (state) => {
    expect(parseGpuArbiterStatus({ state })).toEqual({ state });
  });

  test('sanitizes optional fields and maps future states to unknown', () => {
    expect(parseGpuArbiterStatus({
      state: 'future_state',
      holder: ' qwen ',
      requestedBy: 'kokoro',
      queuePosition: 1.8,
      retryAfterMs: 1_250.9,
      ignored: 'field',
    })).toEqual({
      state: 'unknown',
      holder: 'qwen',
      requestedBy: 'kokoro',
      queuePosition: 1,
      retryAfterMs: 1_250,
    });
    expect(parseGpuArbiterStatus({ state: 42 })).toBeNull();
    expect(parseGpuArbiterStatus(null)).toBeNull();
  });

  test('accepts the deployed camelCase payload and ignores nullable or additional fields', () => {
    expect(parseGpuArbiterStatus({
      state: 'starting_kokoro',
      holder: null,
      requestedBy: 'kokoro',
      queuePosition: 1,
      message: 'The shared GPU is being prepared for Kokoro',
      retryAfterMs: 1_000,
      kokoroPending: 1,
      kokoroActive: 0,
      qwenActive: false,
    })).toEqual({
      state: 'starting_kokoro',
      requestedBy: 'kokoro',
      queuePosition: 1,
      message: 'The shared GPU is being prepared for Kokoro',
      retryAfterMs: 1_000,
    });
  });

  test('requires both the feature flag and a valid server-side HTTP URL', () => {
    expect(getGpuArbiterConfig({
      GPU_QUEUE_STATUS_ENABLED: 'true',
      GPU_ARBITER_STATUS_URL: 'http://192.168.90.246:11435/gpu/status',
    })).toMatchObject({
      statusUrl: 'http://192.168.90.246:11435/gpu/status',
      pollIntervalMs: 1_500,
    });
    expect(getGpuArbiterConfig({
      GPU_QUEUE_STATUS_ENABLED: 'false',
      GPU_ARBITER_STATUS_URL: 'http://192.168.90.246:11435/gpu/status',
    })).toBeNull();
    expect(getGpuArbiterConfig({
      GPU_QUEUE_STATUS_ENABLED: 'true',
      GPU_ARBITER_STATUS_URL: 'file:///tmp/gpu-status',
    })).toBeNull();
  });
});

describe('GPU queue observation', () => {
  test('reports waiting, release, and automatic phase cleanup around the real request', async () => {
    vi.useFakeTimers();
    const operation = deferred<Buffer>();
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ state: 'waiting_for_qwen', retryAfterMs: 1_000 }))
      .mockResolvedValueOnce(jsonResponse({ state: 'kokoro_active' }));
    const observed: Array<string | null> = [];

    const result = runWithGpuQueueStatus({
      request: { provider: 'custom-openai', model: 'kokoro' },
      operation: () => operation.promise,
      config: testConfig,
      fetchImpl,
      onStatus: (status) => { observed.push(status?.state ?? null); },
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(observed).toContain('waiting_for_qwen');
    await vi.advanceTimersByTimeAsync(1_000);
    expect(observed).toContain('kokoro_active');

    operation.resolve(Buffer.from('audio'));
    await expect(result).resolves.toEqual(Buffer.from('audio'));
    expect(observed.at(-1)).toBeNull();
  });

  test.each([
    ['unavailable', vi.fn().mockRejectedValue(new Error('connection refused'))],
    ['malformed', vi.fn().mockResolvedValue(jsonResponse({ state: 12 }))],
  ])('treats an %s status endpoint as advisory', async (_label, fetchImpl) => {
    const operation = deferred<string>();
    const result = runWithGpuQueueStatus({
      request: { provider: 'custom-openai', model: 'kokoro' },
      operation: () => operation.promise,
      config: testConfig,
      fetchImpl,
    });

    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledOnce());
    operation.resolve('tts completed');
    await expect(result).resolves.toBe('tts completed');
  });

  test('aborts an arbiter-held TTS operation when the audiobook is cancelled', async () => {
    const controller = new AbortController();
    const observed: Array<string | null> = [];
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ state: 'starting_kokoro' }));
    const result = runWithGpuQueueStatus({
      request: { provider: 'custom-openai', model: 'kokoro' },
      signal: controller.signal,
      config: testConfig,
      fetchImpl,
      onStatus: (status) => { observed.push(status?.state ?? null); },
      // The wrapper must stop this caller even if an upstream shared/in-flight
      // request does not reject when this individual consumer is cancelled.
      operation: () => new Promise<string>(() => {}),
    });

    await vi.waitFor(() => expect(observed).toContain('starting_kokoro'));
    controller.abort();
    await expect(result).rejects.toMatchObject({ name: 'AbortError' });
    expect(observed.at(-1)).toBeNull();
  });

  test.each([
    { provider: 'custom-openai', model: 'gpt-4o-mini-tts' },
    { provider: 'replicate', model: 'hexgrad/Kokoro-82M' },
    { provider: 'openai', model: 'kokoro' },
  ])('does not poll for an ordinary non-arbiter provider: $provider/$model', async (request) => {
    const fetchImpl = vi.fn();
    await expect(runWithGpuQueueStatus({
      request,
      operation: async () => 'ordinary TTS',
      config: testConfig,
      fetchImpl,
    })).resolves.toBe('ordinary TTS');
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
