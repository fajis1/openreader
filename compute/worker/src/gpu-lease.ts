import {
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  rmdir,
  stat,
  unlink,
  utimes,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const DEFAULT_POLL_MS = 1_000;
const DEFAULT_TIMEOUT_MS = 24 * 60 * 60 * 1_000;
const DEFAULT_STALE_MS = 2 * 60 * 60 * 1_000;
const DEFAULT_SETTLEMENT_GRACE_MS = 60_000;
const MIN_STALE_MS = 60_000;
const LOCK_NAME_PATTERN = /^[a-zA-Z0-9._-]{1,64}$/;
let localLeaseTail: Promise<void> = Promise.resolve();

interface GpuLeaseConfig {
  lockPath: string;
  pollMs: number;
  timeoutMs: number;
  staleMs: number;
  settlementGraceMs: number;
}

type ProviderMode = 'cpu' | 'cuda' | 'auto';
type SelectedProvider = 'cpu' | 'cuda' | null;

export function shouldAcquireGpuLease(input: {
  mode: ProviderMode;
  selectedProvider: SelectedProvider;
  canReuseSelectedProvider?: boolean;
}): boolean {
  return input.mode === 'cuda'
    || (
      input.mode === 'auto'
      && (input.selectedProvider !== 'cpu' || input.canReuseSelectedProvider !== true)
    );
}

export function createGpuLeaseProviderObserver(input: {
  workload: 'pdf-layout' | 'whisper';
  selectedProvider: SelectedProvider;
  release: () => Promise<void>;
}) {
  let selectedCudaForJob = input.selectedProvider === 'cuda';
  let observedSelections = 0;
  const expectedSelections = input.workload === 'whisper' ? 3 : 1;
  return async (selection: {
    workload: 'pdf-layout' | 'whisper';
    provider: Exclude<SelectedProvider, null>;
  }) => {
    if (selection.workload !== input.workload) return;
    observedSelections += 1;
    if (selection.provider === 'cuda') {
      selectedCudaForJob = true;
    } else if (!selectedCudaForJob && observedSelections >= expectedSelections) {
      await input.release();
    }
  };
}

function readPositiveInt(name: string, fallback: number): number {
  const parsed = Number(process.env[name]?.trim());
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

export function getGpuLeaseConfig(): GpuLeaseConfig | null {
  const lockDir = process.env.COMPUTE_GPU_LOCK_DIR?.trim();
  if (!lockDir) return null;
  const lockName = process.env.COMPUTE_GPU_LOCK_NAME?.trim() || 'openreader-gpu';
  if (!LOCK_NAME_PATTERN.test(lockName)) {
    throw new Error('COMPUTE_GPU_LOCK_NAME must contain only letters, numbers, dots, underscores, or hyphens.');
  }
  return {
    lockPath: path.join(path.resolve(lockDir), `${lockName}.lock`),
    pollMs: readPositiveInt('COMPUTE_GPU_LOCK_POLL_MS', DEFAULT_POLL_MS),
    timeoutMs: readPositiveInt('COMPUTE_GPU_LOCK_TIMEOUT_MS', DEFAULT_TIMEOUT_MS),
    staleMs: Math.max(MIN_STALE_MS, readPositiveInt('COMPUTE_GPU_LOCK_STALE_MS', DEFAULT_STALE_MS)),
    settlementGraceMs: readPositiveInt(
      'COMPUTE_GPU_LOCK_SETTLEMENT_GRACE_MS',
      DEFAULT_SETTLEMENT_GRACE_MS,
    ),
  };
}

function isAlreadyExists(error: unknown): boolean {
  return (error as NodeJS.ErrnoException)?.code === 'EEXIST';
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function acquireLocalLease(): Promise<() => void> {
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const previous = localLeaseTail;
  localLeaseTail = previous.then(() => held);
  await previous;
  return release;
}

async function reclaimStaleLease(config: GpuLeaseConfig): Promise<boolean> {
  let heartbeatPath = config.lockPath;
  try {
    const entries = await readdir(config.lockPath);
    const ownerEntry = entries.find((entry) => entry.startsWith('owner-') && entry.endsWith('.json'));
    if (ownerEntry) heartbeatPath = path.join(config.lockPath, ownerEntry);
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return true;
    throw error;
  }

  let heartbeatStat;
  try {
    heartbeatStat = await stat(heartbeatPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return true;
    throw error;
  }
  if (Date.now() - heartbeatStat.mtimeMs < config.staleMs) return false;

  const quarantinePath = `${config.lockPath}.stale-${randomUUID()}`;
  try {
    await rename(config.lockPath, quarantinePath);
    await rm(quarantinePath, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}

async function readLeaseOwner(lockPath: string): Promise<string | null> {
  try {
    const entries = await readdir(lockPath);
    const ownerEntry = entries.find((entry) => entry.startsWith('owner-') && entry.endsWith('.json'));
    if (!ownerEntry) return null;
    return await readFile(path.join(lockPath, ownerEntry), 'utf8');
  } catch {
    return null;
  }
}

export async function withGpuLease<T>(input: {
  label: string;
  run: (lease: { release: () => Promise<void> }) => Promise<T>;
  holdAfterError?: (error: unknown) => Promise<void> | null;
  onHoldExpired?: () => void;
  onWait?: (details: { lockPath: string; owner: string | null }) => void;
  onAcquired?: () => void;
}): Promise<T> {
  const config = getGpuLeaseConfig();
  if (!config) {
    const releaseLocal = await acquireLocalLease();
    let released = false;
    let releaseDeferred = false;
    const releaseLease = async () => {
      if (released) return;
      released = true;
      releaseLocal();
    };
    try {
      input.onAcquired?.();
      return await input.run({ release: releaseLease });
    } catch (error) {
      const hold = input.holdAfterError?.(error);
      if (hold) {
        releaseDeferred = true;
        const graceMs = readPositiveInt(
          'COMPUTE_GPU_LOCK_SETTLEMENT_GRACE_MS',
          DEFAULT_SETTLEMENT_GRACE_MS,
        );
        const graceTimer = setTimeout(() => {
          void releaseLease().finally(() => {
            if (input.onHoldExpired) input.onHoldExpired();
            else process.exit(1);
          });
        }, graceMs);
        void hold.then(
          async () => {
            clearTimeout(graceTimer);
            await releaseLease();
          },
          async () => {
            clearTimeout(graceTimer);
            await releaseLease();
          },
        );
      }
      throw error;
    } finally {
      if (!releaseDeferred) await releaseLease();
    }
  }

  await mkdir(path.dirname(config.lockPath), { recursive: true });
  const startedAt = Date.now();
  let lastWaitLogAt = 0;

  while (true) {
    try {
      await mkdir(config.lockPath);
      break;
    } catch (error) {
      if (!isAlreadyExists(error)) throw error;
      if (await reclaimStaleLease(config)) continue;
      if (Date.now() - startedAt >= config.timeoutMs) {
        throw new Error(`Timed out waiting for shared GPU lease ${config.lockPath}.`);
      }
      if (input.onWait && Date.now() - lastWaitLogAt >= 30_000) {
        lastWaitLogAt = Date.now();
        const owner = await readLeaseOwner(config.lockPath);
        input.onWait({ lockPath: config.lockPath, owner });
      }
      await sleep(config.pollMs);
    }
  }

  const now = new Date();
  const leaseId = randomUUID();
  const ownerPath = path.join(config.lockPath, `owner-${leaseId}.json`);
  try {
    await writeFile(ownerPath, JSON.stringify({
      leaseId,
      label: input.label,
      pid: process.pid,
      acquiredAt: now.toISOString(),
    }), { flag: 'wx' });
  } catch (error) {
    await unlink(ownerPath).catch(() => {});
    await rmdir(config.lockPath).catch(() => {});
    throw error;
  }
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let releaseDeferred = false;
  let releasePromise: Promise<void> | null = null;
  const releaseLease = () => {
    if (!releasePromise) {
      releasePromise = (async () => {
        if (heartbeat) {
          clearInterval(heartbeat);
          heartbeat = null;
        }
        const removedOwner = await unlink(ownerPath).then(() => true).catch(() => false);
        if (removedOwner) {
          await rmdir(config.lockPath).catch(() => {});
        }
      })();
    }
    return releasePromise;
  };
  try {
    input.onAcquired?.();
    heartbeat = setInterval(() => {
      const heartbeatAt = new Date();
      void utimes(ownerPath, heartbeatAt, heartbeatAt).catch(() => {});
    }, Math.min(30_000, Math.max(5_000, Math.floor(config.staleMs / 4))));
    return await input.run({ release: releaseLease });
  } catch (error) {
    const hold = input.holdAfterError?.(error);
    if (hold) {
      releaseDeferred = true;
      const graceTimer = setTimeout(() => {
        void releaseLease().finally(() => {
          if (input.onHoldExpired) input.onHoldExpired();
          else process.exit(1);
        });
      }, config.settlementGraceMs);
      void hold.then(
        async () => {
          clearTimeout(graceTimer);
          await releaseLease();
        },
        async () => {
          clearTimeout(graceTimer);
          await releaseLease();
        },
      );
    }
    throw error;
  } finally {
    if (!releaseDeferred) await releaseLease();
  }
}
