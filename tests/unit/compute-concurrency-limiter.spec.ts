import { expect, test } from '@playwright/test';
import { ConcurrencyLimiter } from '../../src/lib/server/compute/concurrency-limiter';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test.describe('compute-concurrency-limiter', () => {
  test('caps active jobs at configured limit', async () => {
    const limiter = new ConcurrencyLimiter(2);
    let inFlight = 0;
    let maxInFlightSeen = 0;

    const jobs = Array.from({ length: 6 }, (_, i) => limiter.run(async () => {
      inFlight += 1;
      maxInFlightSeen = Math.max(maxInFlightSeen, inFlight);
      await sleep(20 + (i % 2) * 5);
      inFlight -= 1;
      return i;
    }));

    const result = await Promise.all(jobs);
    expect(result).toEqual([0, 1, 2, 3, 4, 5]);
    expect(maxInFlightSeen).toBe(2);
  });

  test('queues in FIFO order when saturated', async () => {
    const limiter = new ConcurrencyLimiter(1);
    const starts: number[] = [];

    const one = limiter.run(async () => {
      starts.push(1);
      await sleep(25);
    });
    const two = limiter.run(async () => {
      starts.push(2);
      await sleep(5);
    });
    const three = limiter.run(async () => {
      starts.push(3);
      await sleep(1);
    });

    await Promise.all([one, two, three]);
    expect(starts).toEqual([1, 2, 3]);
  });

  test('releases slot after failure', async () => {
    const limiter = new ConcurrencyLimiter(1);
    let startedSecond = false;

    const first = limiter.run(async () => {
      await sleep(10);
      throw new Error('boom');
    });
    const second = limiter.run(async () => {
      startedSecond = true;
      return 'ok';
    });

    await expect(first).rejects.toThrow('boom');
    await expect(second).resolves.toBe('ok');
    expect(startedSecond).toBeTruthy();
  });
});
