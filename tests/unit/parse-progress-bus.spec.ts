import { expect, test } from '@playwright/test';
import { __resetParseProgressBusForTests, getParseProgressBus } from '../../src/lib/server/documents/parse-progress-bus';
import { InMemoryParseProgressBus } from '../../src/lib/server/documents/parse-progress-bus.memory';
import { hashUserId, type ParseProgressEvent } from '../../src/lib/server/documents/parse-progress-events';

test.describe('parse progress bus', () => {
  test.afterEach(() => {
    __resetParseProgressBusForTests();
  });

  test('uses in-memory singleton bus', async () => {
    const busA = await getParseProgressBus();
    const busB = await getParseProgressBus();
    expect(busA.kind).toBe('memory');
    expect(busA).toBe(busB);
  });

  test('in-memory bus publishes only to subscribed user hashes', async () => {
    const bus = new InMemoryParseProgressBus();
    const documentId = 'd'.repeat(64);
    const wantedHash = hashUserId('user-a');
    const otherHash = hashUserId('user-b');
    const received: ParseProgressEvent[] = [];

    const close = await bus.subscribe({
      documentId,
      userIdHashes: new Set([wantedHash]),
      onEvent: (event) => {
        received.push(event);
      },
    });

    await bus.publish({
      version: 1,
      documentId,
      userIdHash: otherHash,
      parseStatus: 'running',
      parseProgress: { totalPages: 4, pagesParsed: 1, currentPage: 2, phase: 'infer' },
      updatedAt: Date.now(),
    });

    await bus.publish({
      version: 1,
      documentId,
      userIdHash: wantedHash,
      parseStatus: 'running',
      parseProgress: { totalPages: 4, pagesParsed: 2, currentPage: 3, phase: 'infer' },
      updatedAt: Date.now(),
      opId: 'op-1',
    });

    close();
    expect(received).toHaveLength(1);
    expect(received[0].userIdHash).toBe(wantedHash);
    expect(received[0].opId).toBe('op-1');
  });
});
