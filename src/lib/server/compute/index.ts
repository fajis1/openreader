import type { ComputeBackend, ComputeMode } from '@/lib/server/compute/types';
import { isComputeModeAvailable, readComputeMode } from '@/lib/server/compute/mode';
import { WorkerComputeBackend } from '@/lib/server/compute/worker';

let backendPromise: Promise<ComputeBackend> | null = null;

async function createBackend(): Promise<ComputeBackend> {
  const mode: ComputeMode = readComputeMode();
  if (mode === 'worker') return new WorkerComputeBackend();
  const { LocalComputeBackend } = await import('@/lib/server/compute/local');
  return new LocalComputeBackend();
}

export async function getCompute(): Promise<ComputeBackend> {
  if (!backendPromise) {
    backendPromise = createBackend().catch((error) => {
      backendPromise = null;
      throw error;
    });
  }
  return backendPromise;
}

export function isComputeAvailable(): boolean {
  return isComputeModeAvailable();
}
