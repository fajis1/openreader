import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const createSession = vi.hoisted(() => vi.fn());
const cudaDeviceVisible = vi.hoisted(() => ({ value: true }));

vi.mock('onnxruntime-node', () => ({
  InferenceSession: {
    create: createSession,
  },
}));
vi.mock('node:fs', () => ({
  existsSync: () => cudaDeviceVisible.value,
  readdirSync: () => cudaDeviceVisible.value ? ['nvidia0', 'nvidiactl'] : [],
}));

const ENV_NAMES = [
  'COMPUTE_ONNX_EXECUTION_PROVIDER',
  'PDF_LAYOUT_ONNX_EXECUTION_PROVIDER',
  'WHISPER_ONNX_EXECUTION_PROVIDER',
  'COMPUTE_CUDA_DEVICE_ID',
  'COMPUTE_CUDA_ALLOW_CPU_FALLBACK',
  'COMPUTE_RELEASE_ONNX_SESSIONS_AFTER_JOB',
] as const;

describe('ONNX execution provider configuration', () => {
  const originalEnv: Partial<Record<(typeof ENV_NAMES)[number], string | undefined>> = {};

  beforeEach(() => {
    createSession.mockReset();
    createSession.mockResolvedValue({ release: vi.fn() });
    cudaDeviceVisible.value = true;
    for (const name of ENV_NAMES) {
      originalEnv[name] = process.env[name];
      delete process.env[name];
    }
  });

  afterEach(() => {
    for (const name of ENV_NAMES) {
      const value = originalEnv[name];
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  test('defaults to CPU so existing deployments retain their current behavior', async () => {
    const { createConfiguredOnnxSession, getOnnxExecutionProviderConfig } = await import(
      '../../src/config/onnx-execution-provider'
    );

    expect(getOnnxExecutionProviderConfig('pdf-layout')).toEqual({
      mode: 'cpu',
      deviceId: 0,
      allowCpuFallback: false,
      releaseAfterJob: false,
    });

    await createConfiguredOnnxSession({
      workload: 'pdf-layout',
      modelPath: '/tmp/layout.onnx',
      sessionOptions: { graphOptimizationLevel: 'all' },
    });

    expect(createSession).toHaveBeenCalledWith('/tmp/layout.onnx', expect.objectContaining({
      executionProviders: ['cpu'],
    }));
  });

  test('allows PDF layout on CUDA while keeping Whisper on CPU', async () => {
    process.env.PDF_LAYOUT_ONNX_EXECUTION_PROVIDER = 'cuda';
    process.env.WHISPER_ONNX_EXECUTION_PROVIDER = 'cpu';
    process.env.COMPUTE_CUDA_DEVICE_ID = '2';
    process.env.COMPUTE_RELEASE_ONNX_SESSIONS_AFTER_JOB = 'true';

    const { getOnnxExecutionProviderConfig } = await import('../../src/config/onnx-execution-provider');

    expect(getOnnxExecutionProviderConfig('pdf-layout')).toEqual({
      mode: 'cuda',
      deviceId: 2,
      allowCpuFallback: false,
      releaseAfterJob: true,
    });
    expect(getOnnxExecutionProviderConfig('whisper').mode).toBe('cpu');
  });

  test('fails loudly when CUDA is explicitly required', async () => {
    process.env.COMPUTE_ONNX_EXECUTION_PROVIDER = 'cuda';
    createSession.mockRejectedValueOnce(new Error('CUDA unavailable'));

    const { createConfiguredOnnxSession } = await import('../../src/config/onnx-execution-provider');
    await expect(createConfiguredOnnxSession({
      workload: 'pdf-layout',
      modelPath: '/tmp/layout.onnx',
      sessionOptions: { graphOptimizationLevel: 'all' },
    })).rejects.toThrow('CUDA unavailable');

    expect(createSession).toHaveBeenCalledOnce();
    expect(createSession).toHaveBeenCalledWith('/tmp/layout.onnx', expect.objectContaining({
      executionProviders: [{ name: 'cuda', deviceId: 0 }],
      extra: {
        session: {
          disable_cpu_ep_fallback: '1',
        },
      },
    }));
  });

  test('rejects required CUDA before native initialization when no GPU device is visible', async () => {
    process.env.COMPUTE_ONNX_EXECUTION_PROVIDER = 'cuda';
    cudaDeviceVisible.value = false;

    const { createConfiguredOnnxSession } = await import('../../src/config/onnx-execution-provider');
    await expect(createConfiguredOnnxSession({
      workload: 'pdf-layout',
      modelPath: '/tmp/layout.onnx',
      sessionOptions: { graphOptimizationLevel: 'all' },
    })).rejects.toThrow('NVIDIA device nodes are not visible');

    expect(createSession).not.toHaveBeenCalled();
  });

  test('retries session creation on CPU only in auto mode', async () => {
    process.env.COMPUTE_ONNX_EXECUTION_PROVIDER = 'auto';
    createSession
      .mockRejectedValueOnce(new Error('CUDA unavailable'))
      .mockResolvedValueOnce({ release: vi.fn() });

    const {
      createConfiguredOnnxSession,
      getSelectedOnnxProvider,
      runWithOnnxProviderObserver,
    } = await import('../../src/config/onnx-execution-provider');
    const observations: string[] = [];
    await runWithOnnxProviderObserver(
      ({ provider }) => {
        observations.push(provider);
      },
      async () => createConfiguredOnnxSession({
        workload: 'pdf-layout',
        modelPath: '/tmp/layout.onnx',
        sessionOptions: { graphOptimizationLevel: 'all' },
      }),
    );

    expect(createSession).toHaveBeenNthCalledWith(1, '/tmp/layout.onnx', expect.objectContaining({
      executionProviders: [{ name: 'cuda', deviceId: 0 }, 'cpu'],
    }));
    expect(createSession).toHaveBeenNthCalledWith(2, '/tmp/layout.onnx', expect.objectContaining({
      executionProviders: ['cpu'],
    }));
    expect(observations).toEqual(['cpu']);
    expect(getSelectedOnnxProvider('pdf-layout')).toBe('cpu');
  });
});
