import { describe, expect, test } from 'vitest';
import type { WorkerOperationRequest } from '../../src/api-contracts';
import {
  InMemoryOperationEventStream,
  InMemoryOperationQueue,
  InMemoryOperationStateStore,
  OperationOrchestrator,
} from '../../src/control-plane';

function buildRequest(opKey: string): WorkerOperationRequest {
  return {
    kind: 'pdf_layout',
    opKey,
    payload: {
      documentId: `doc-${opKey}`,
      namespace: null,
      documentObjectKey: `s3://bucket/${opKey}.pdf`,
    },
  };
}

describe('operation orchestrator', () => {
  test('reuses fresh operation and replaces stale operation', async () => {
    let now = 1_000;
    let nextId = 1;
    const queue = new InMemoryOperationQueue();
    const stateStore = new InMemoryOperationStateStore();
    const eventStream = new InMemoryOperationEventStream();

    const orchestrator = new OperationOrchestrator({
      queue,
      stateStore,
      eventStream,
      config: { opStaleMs: 2_000, maxCasRetries: 5 },
      clock: { now: () => now },
      idFactory: {
        opId: () => `op-${nextId}`,
        jobId: () => `job-${nextId++}`,
      },
    });

    const request = buildRequest('shared-op');

    const first = await orchestrator.enqueueOrReuse(request);
    expect(first.opId).toBe('op-1');

    now = 2_000;
    const reused = await orchestrator.enqueueOrReuse(request);
    expect(reused.opId).toBe('op-1');

    await orchestrator.markRunning({ opId: first.opId, updatedAt: 2_100 });

    now = 6_000;
    const replaced = await orchestrator.enqueueOrReuse(request);
    expect(replaced.opId).toBe('op-2');
    expect(await stateStore.getOpIndex('shared-op')).toEqual({ opId: 'op-2' });
    expect(queue.size('pdf_layout')).toBe(2);
  });

  test('survives transient CAS conflict and eventually creates operation', async () => {
    const queue = new InMemoryOperationQueue();
    const eventStream = new InMemoryOperationEventStream();
    const store = new InMemoryOperationStateStore();

    let firstAttempt = true;
    const conflictStore = {
      getOpState: store.getOpState.bind(store),
      putOpState: store.putOpState.bind(store),
      getOpIndex: store.getOpIndex.bind(store),
      compareAndSetOpIndex: async (input: { opKey: string; newOpId: string; expectedOpId: string | null }) => {
        if (firstAttempt && input.expectedOpId === null) {
          firstAttempt = false;
          return false;
        }
        return store.compareAndSetOpIndex(input);
      },
    };

    let id = 1;
    const orchestrator = new OperationOrchestrator({
      queue,
      stateStore: conflictStore,
      eventStream,
      config: { opStaleMs: 2_000, maxCasRetries: 4 },
      idFactory: {
        opId: () => `op-${id}`,
        jobId: () => `job-${id++}`,
      },
    });

    const created = await orchestrator.enqueueOrReuse(buildRequest('cas-key'));
    expect(created.opId).toMatch(/^op-/);
    expect(await store.getOpIndex('cas-key')).toEqual({ opId: created.opId });
  });
});
