import { describe, expect, test } from 'vitest';
import {
  getTimedOutOperationSettlement,
  withIdleTimeoutAndHardCapAndSettlement,
  withTimeoutAndSettlement,
} from '../../src/config/timeout';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe('settlement-aware compute timeouts', () => {
  test('rejects a hard timeout promptly while exposing operation settlement', async () => {
    const operation = deferred<string>();
    const error = await withTimeoutAndSettlement(operation.promise, 5, 'gpu operation')
      .catch((caught) => caught as unknown);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe('gpu operation timed out after 5ms');
    const settlement = getTimedOutOperationSettlement(error);
    expect(settlement).not.toBeNull();
    let operationSettled = false;
    void settlement!.then(() => {
      operationSettled = true;
    });
    await delay(10);
    expect(operationSettled).toBe(false);

    operation.resolve('completed too late');
    await settlement;
    expect(operationSettled).toBe(true);
  });

  test('rejects an idle timeout promptly while exposing operation settlement', async () => {
    const operation = deferred<string>();
    const error = await withIdleTimeoutAndHardCapAndSettlement({
      idleTimeoutMs: 5,
      hardCapMs: 100,
      label: 'layout operation',
      run: async () => operation.promise,
    }).catch((caught) => caught as unknown);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe('layout operation idle timed out after 5ms');
    const settlement = getTimedOutOperationSettlement(error);
    expect(settlement).not.toBeNull();
    let operationSettled = false;
    void settlement!.then(() => {
      operationSettled = true;
    });
    await delay(10);
    expect(operationSettled).toBe(false);

    operation.resolve('completed too late');
    await settlement;
    expect(operationSettled).toBe(true);
  });
});
