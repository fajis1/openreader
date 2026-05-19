import type { ComputeBackend, ComputeMode } from '@/lib/server/compute/types';
import { NoneComputeBackend } from '@/lib/server/compute/none';
import { isComputeModeAvailable, readComputeMode } from '@/lib/server/compute/mode';
import { WorkerComputeBackend } from '@/lib/server/compute/worker';

let backend: ComputeBackend | null = null;

function createBackend(): ComputeBackend {
  const mode: ComputeMode = readComputeMode();
  if (mode === 'none') return new NoneComputeBackend();
  if (mode === 'worker') return new WorkerComputeBackend();
  // Intentionally lazy-load local compute so COMPUTE_MODE=none builds
  // can avoid tracing heavy ONNX dependencies.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { LocalComputeBackend } = require('@/lib/server/compute/local') as typeof import('@/lib/server/compute/local');
  return new LocalComputeBackend();
}

export function getCompute(): ComputeBackend {
  if (!backend) backend = createBackend();
  return backend;
}

export function isComputeAvailable(): boolean {
  return isComputeModeAvailable(readComputeMode());
}
