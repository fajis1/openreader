import os from 'node:os';
import fs from 'node:fs/promises';

/**
 * Returns true if the system has at least 20% free resources.
 */
export async function checkSystemResources(): Promise<{ ok: boolean; reason?: string }> {
  if (process.env.ENABLE_TEST_NAMESPACE === 'true') {
    return { ok: true };
  }

  try {
    // 1. Check Memory (20% free)
    const freeMem = os.freemem();
    const totalMem = os.totalmem();
    if (freeMem / totalMem < 0.2) {
      return { ok: false, reason: `Memory low: ${(freeMem / 1024 / 1024).toFixed(2)}MB free of ${(totalMem / 1024 / 1024).toFixed(2)}MB` };
    }

    // 2. Check CPU (Load average over 1 min should not exceed 80% of core count)
    const cpus = os.cpus().length;
    const load1 = os.loadavg()[0]; // 1 minute load average
    if (load1 / cpus > 0.8) {
      return { ok: false, reason: `CPU load high: ${load1.toFixed(2)} on ${cpus} cores` };
    }

    // 3. Check Storage Space (20% free)
    // Using fs.statfs on the root or app directory (assuming linux/mac)
    try {
      const stats = await fs.statfs('/');
      const freeSpace = stats.bfree * stats.bsize;
      const totalSpace = stats.blocks * stats.bsize;
      if (freeSpace / totalSpace < 0.2) {
        return { ok: false, reason: `Disk space low: ${(freeSpace / 1024 / 1024 / 1024).toFixed(2)}GB free of ${(totalSpace / 1024 / 1024 / 1024).toFixed(2)}GB` };
      }
    } catch {
      // Ignored if statfs is not supported
    }

    return { ok: true };
  } catch {
    return { ok: false, reason: 'Failed to read system resources' };
  }
}
