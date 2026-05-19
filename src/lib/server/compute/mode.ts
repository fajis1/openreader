import type { ComputeMode } from '@/lib/server/compute/types';

export function readComputeMode(): ComputeMode {
  const raw = (process.env.COMPUTE_MODE || 'local').trim().toLowerCase();
  if (raw === 'local' || raw === 'none' || raw === 'worker') return raw;
  return 'local';
}

export function isComputeModeAvailable(mode: ComputeMode): boolean {
  return mode !== 'none';
}
