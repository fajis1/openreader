import { describe, expect, test, vi } from 'vitest';
import { runWithCudaOomCpuFallback } from '../../src/cuda-oom-fallback';

describe('CUDA OOM CPU fallback', () => {
  test('releases the GPU lease before starting the CPU retry', async () => {
    const order: string[] = [];
    const result = await runWithCudaOomCpuFallback({
      enabled: true,
      isCudaOutOfMemory: () => true,
      runCuda: async () => {
        order.push('cuda');
        throw new Error('CUDA_ERROR_OUT_OF_MEMORY');
      },
      releaseGpuLease: async () => {
        order.push('release');
      },
      beforeCpuRetry: () => {
        order.push('log');
      },
      runCpu: async () => {
        order.push('cpu');
        return 'done';
      },
    });

    expect(result).toBe('done');
    expect(order).toEqual(['cuda', 'log', 'release', 'cpu']);
  });

  test('does not release or retry for non-CUDA failures', async () => {
    const releaseGpuLease = vi.fn();
    const runCpu = vi.fn();

    await expect(runWithCudaOomCpuFallback({
      enabled: true,
      isCudaOutOfMemory: () => false,
      runCuda: async () => {
        throw new Error('invalid PDF');
      },
      releaseGpuLease,
      runCpu,
    })).rejects.toThrow('invalid PDF');

    expect(releaseGpuLease).not.toHaveBeenCalled();
    expect(runCpu).not.toHaveBeenCalled();
  });
});
