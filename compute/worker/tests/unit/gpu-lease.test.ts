import { mkdtemp, readdir, rm, stat, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import {
  getTimedOutOperationSettlement,
  withTimeoutAndSettlement,
} from '@openreader/compute-core';
import {
  createGpuLeaseProviderObserver,
  getGpuLeaseConfig,
  shouldAcquireGpuLease,
  withGpuLease,
} from '../../src/gpu-lease';

const ORIGINAL_ENV = {
  lockDir: process.env.COMPUTE_GPU_LOCK_DIR,
  lockName: process.env.COMPUTE_GPU_LOCK_NAME,
  pollMs: process.env.COMPUTE_GPU_LOCK_POLL_MS,
  staleMs: process.env.COMPUTE_GPU_LOCK_STALE_MS,
  timeoutMs: process.env.COMPUTE_GPU_LOCK_TIMEOUT_MS,
  settlementGraceMs: process.env.COMPUTE_GPU_LOCK_SETTLEMENT_GRACE_MS,
};

afterEach(() => {
  if (ORIGINAL_ENV.lockDir === undefined) delete process.env.COMPUTE_GPU_LOCK_DIR;
  else process.env.COMPUTE_GPU_LOCK_DIR = ORIGINAL_ENV.lockDir;
  if (ORIGINAL_ENV.lockName === undefined) delete process.env.COMPUTE_GPU_LOCK_NAME;
  else process.env.COMPUTE_GPU_LOCK_NAME = ORIGINAL_ENV.lockName;
  if (ORIGINAL_ENV.pollMs === undefined) delete process.env.COMPUTE_GPU_LOCK_POLL_MS;
  else process.env.COMPUTE_GPU_LOCK_POLL_MS = ORIGINAL_ENV.pollMs;
  if (ORIGINAL_ENV.staleMs === undefined) delete process.env.COMPUTE_GPU_LOCK_STALE_MS;
  else process.env.COMPUTE_GPU_LOCK_STALE_MS = ORIGINAL_ENV.staleMs;
  if (ORIGINAL_ENV.timeoutMs === undefined) delete process.env.COMPUTE_GPU_LOCK_TIMEOUT_MS;
  else process.env.COMPUTE_GPU_LOCK_TIMEOUT_MS = ORIGINAL_ENV.timeoutMs;
  if (ORIGINAL_ENV.settlementGraceMs === undefined) {
    delete process.env.COMPUTE_GPU_LOCK_SETTLEMENT_GRACE_MS;
  } else {
    process.env.COMPUTE_GPU_LOCK_SETTLEMENT_GRACE_MS = ORIGINAL_ENV.settlementGraceMs;
  }
});

describe('shared GPU lease', () => {
  test('bypasses or releases the lease for an actual CPU fallback', async () => {
    expect(shouldAcquireGpuLease({
      mode: 'auto',
      selectedProvider: 'cpu',
      canReuseSelectedProvider: true,
    })).toBe(false);
    expect(shouldAcquireGpuLease({
      mode: 'auto',
      selectedProvider: 'cpu',
      canReuseSelectedProvider: false,
    })).toBe(true);
    expect(shouldAcquireGpuLease({ mode: 'auto', selectedProvider: null })).toBe(true);

    let releases = 0;
    const observe = createGpuLeaseProviderObserver({
      workload: 'pdf-layout',
      selectedProvider: null,
      release: async () => {
        releases += 1;
      },
    });
    await observe({ workload: 'pdf-layout', provider: 'cpu' });
    expect(releases).toBe(1);

    const mixedObserve = createGpuLeaseProviderObserver({
      workload: 'whisper',
      selectedProvider: null,
      release: async () => {
        releases += 1;
      },
    });
    await mixedObserve({ workload: 'whisper', provider: 'cuda' });
    await mixedObserve({ workload: 'whisper', provider: 'cpu' });
    expect(releases).toBe(1);

    const cpuWhisperObserve = createGpuLeaseProviderObserver({
      workload: 'whisper',
      selectedProvider: null,
      release: async () => {
        releases += 1;
      },
    });
    await cpuWhisperObserve({ workload: 'whisper', provider: 'cpu' });
    await cpuWhisperObserve({ workload: 'whisper', provider: 'cpu' });
    expect(releases).toBe(1);
    await cpuWhisperObserve({ workload: 'whisper', provider: 'cpu' });
    expect(releases).toBe(2);
  });

  test('is disabled when no shared lock directory is configured', () => {
    delete process.env.COMPUTE_GPU_LOCK_DIR;
    expect(getGpuLeaseConfig()).toBeNull();
  });

  test('retains local timeout safety when no shared lock directory is configured', async () => {
    delete process.env.COMPUTE_GPU_LOCK_DIR;
    process.env.COMPUTE_GPU_LOCK_SETTLEMENT_GRACE_MS = '40';
    const nativeWork = new Promise<void>(() => {});
    let restartRequested!: () => void;
    const restartRequest = new Promise<void>((resolve) => {
      restartRequested = resolve;
    });

    const timedOutJob = withGpuLease({
      label: 'layout:local-hung',
      holdAfterError: getTimedOutOperationSettlement,
      onHoldExpired: restartRequested,
      run: async () => withTimeoutAndSettlement(nativeWork, 5, 'local hung layout'),
    });
    await expect(timedOutJob).rejects.toThrow('local hung layout timed out after 5ms');

    let successorEntered = false;
    const successor = withGpuLease({
      label: 'layout:local-successor',
      run: async () => {
        successorEntered = true;
        return 'successor';
      },
    });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(successorEntered).toBe(false);

    await restartRequest;
    await expect(successor).resolves.toBe('successor');
  });

  test('serializes GPU work that uses the same shared lock directory', async () => {
    const lockRoot = await mkdtemp(path.join(tmpdir(), 'openreader-gpu-lease-'));
    process.env.COMPUTE_GPU_LOCK_DIR = lockRoot;
    process.env.COMPUTE_GPU_LOCK_NAME = 'p100';
    process.env.COMPUTE_GPU_LOCK_POLL_MS = '5';

    let releaseFirst!: () => void;
    const firstCanFinish = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let firstEntered!: () => void;
    const firstStarted = new Promise<void>((resolve) => {
      firstEntered = resolve;
    });
    let secondStarted = false;
    let secondAcquired = false;

    try {
      const first = withGpuLease({
        label: 'layout:first',
        run: async () => {
          firstEntered();
          await firstCanFinish;
          return 'first';
        },
      });
      await firstStarted;

      const second = withGpuLease({
        label: 'layout:second',
        onAcquired: () => {
          secondAcquired = true;
        },
        run: async () => {
          secondStarted = true;
          return 'second';
        },
      });

      await new Promise((resolve) => setTimeout(resolve, 25));
      expect(secondStarted).toBe(false);
      expect(secondAcquired).toBe(false);
      releaseFirst();

      await expect(first).resolves.toBe('first');
      await expect(second).resolves.toBe('second');
      expect(secondAcquired).toBe(true);
    } finally {
      releaseFirst();
      await rm(lockRoot, { recursive: true, force: true });
    }
  });

  test('an expired holder cannot remove a successor lease', async () => {
    const lockRoot = await mkdtemp(path.join(tmpdir(), 'openreader-gpu-lease-stale-'));
    const lockPath = path.join(lockRoot, 'p100.lock');
    process.env.COMPUTE_GPU_LOCK_DIR = lockRoot;
    process.env.COMPUTE_GPU_LOCK_NAME = 'p100';
    process.env.COMPUTE_GPU_LOCK_POLL_MS = '5';
    process.env.COMPUTE_GPU_LOCK_STALE_MS = '60000';
    process.env.COMPUTE_GPU_LOCK_TIMEOUT_MS = '2000';

    let releaseFirst!: () => void;
    const firstCanFinish = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let firstEntered!: () => void;
    const firstStarted = new Promise<void>((resolve) => {
      firstEntered = resolve;
    });
    let releaseSecond!: () => void;
    const secondCanFinish = new Promise<void>((resolve) => {
      releaseSecond = resolve;
    });
    let secondEntered!: () => void;
    const secondStarted = new Promise<void>((resolve) => {
      secondEntered = resolve;
    });

    try {
      const first = withGpuLease({
        label: 'layout:expired',
        run: async () => {
          firstEntered();
          await firstCanFinish;
          return 'first';
        },
      });
      await firstStarted;

      const [ownerEntry] = (await readdir(lockPath))
        .filter((entry) => entry.startsWith('owner-') && entry.endsWith('.json'));
      expect(ownerEntry).toBeTruthy();
      const staleAt = new Date(Date.now() - 61_000);
      await utimes(path.join(lockPath, ownerEntry!), staleAt, staleAt);

      const second = withGpuLease({
        label: 'layout:successor',
        run: async () => {
          secondEntered();
          await secondCanFinish;
          return 'second';
        },
      });
      await secondStarted;

      releaseFirst();
      await expect(first).resolves.toBe('first');
      await expect(stat(lockPath)).resolves.toBeTruthy();

      let thirdEntered = false;
      const third = withGpuLease({
        label: 'layout:third',
        run: async () => {
          thirdEntered = true;
          return 'third';
        },
      });
      await new Promise((resolve) => setTimeout(resolve, 25));
      expect(thirdEntered).toBe(false);

      releaseSecond();
      await expect(second).resolves.toBe('second');
      await expect(third).resolves.toBe('third');
    } finally {
      releaseFirst();
      releaseSecond();
      await rm(lockRoot, { recursive: true, force: true });
    }
  });

  test('reports a timeout promptly but holds the lease until native work settles', async () => {
    const lockRoot = await mkdtemp(path.join(tmpdir(), 'openreader-gpu-lease-timeout-'));
    process.env.COMPUTE_GPU_LOCK_DIR = lockRoot;
    process.env.COMPUTE_GPU_LOCK_NAME = 'p100';
    process.env.COMPUTE_GPU_LOCK_POLL_MS = '5';
    process.env.COMPUTE_GPU_LOCK_TIMEOUT_MS = '2000';

    let finishNativeWork!: () => void;
    const nativeWork = new Promise<void>((resolve) => {
      finishNativeWork = resolve;
    });

    try {
      const timedOutJob = withGpuLease({
        label: 'layout:timed-out',
        holdAfterError: getTimedOutOperationSettlement,
        run: async () => withTimeoutAndSettlement(nativeWork, 5, 'native layout'),
      });
      await expect(timedOutJob).rejects.toThrow('native layout timed out after 5ms');

      let successorEntered = false;
      const successor = withGpuLease({
        label: 'layout:successor',
        run: async () => {
          successorEntered = true;
          return 'successor';
        },
      });
      await new Promise((resolve) => setTimeout(resolve, 25));
      expect(successorEntered).toBe(false);

      finishNativeWork();
      await expect(successor).resolves.toBe('successor');
    } finally {
      finishNativeWork();
      await rm(lockRoot, { recursive: true, force: true });
    }
  });

  test('releases the lease and requests restart when settlement exceeds its grace', async () => {
    const lockRoot = await mkdtemp(path.join(tmpdir(), 'openreader-gpu-lease-grace-'));
    process.env.COMPUTE_GPU_LOCK_DIR = lockRoot;
    process.env.COMPUTE_GPU_LOCK_NAME = 'p100';
    process.env.COMPUTE_GPU_LOCK_POLL_MS = '5';
    process.env.COMPUTE_GPU_LOCK_TIMEOUT_MS = '2000';
    process.env.COMPUTE_GPU_LOCK_SETTLEMENT_GRACE_MS = '15';

    const nativeWork = new Promise<void>(() => {});
    let restartRequested!: () => void;
    const restartRequest = new Promise<void>((resolve) => {
      restartRequested = resolve;
    });

    try {
      const timedOutJob = withGpuLease({
        label: 'layout:hung',
        holdAfterError: getTimedOutOperationSettlement,
        onHoldExpired: restartRequested,
        run: async () => withTimeoutAndSettlement(nativeWork, 5, 'hung layout'),
      });
      await expect(timedOutJob).rejects.toThrow('hung layout timed out after 5ms');
      await restartRequest;

      await expect(withGpuLease({
        label: 'layout:after-restart-request',
        run: async () => 'successor',
      })).resolves.toBe('successor');
    } finally {
      await rm(lockRoot, { recursive: true, force: true });
    }
  });
});
