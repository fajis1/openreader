import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import {
  cancelPendingPreferenceSync,
  flushUserPreferencesSync,
  scheduleUserPreferencesSync,
} from '../../src/lib/client/api/user-state';

type FetchMock = ReturnType<typeof vi.fn> & { calls: Array<{ url: string; init?: RequestInit }> };

function installFetchMock(responder: () => Response): FetchMock {
  const mock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    mock.calls.push({ url: String(input), init });
    return responder();
  }) as unknown as FetchMock;
  mock.calls = [];
  global.fetch = mock as unknown as typeof fetch;
  return mock;
}

function okResponse(): Response {
  return new Response(
    JSON.stringify({ preferences: {}, clientUpdatedAtMs: Date.now(), applied: true }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

describe('flushUserPreferencesSync', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.useFakeTimers();
    cancelPendingPreferenceSync();
  });

  afterEach(() => {
    cancelPendingPreferenceSync();
    vi.useRealTimers();
    global.fetch = originalFetch;
  });

  test('sends a pending debounced patch immediately instead of waiting for the timer', async () => {
    const fetchMock = installFetchMock(okResponse);

    scheduleUserPreferencesSync({ providerRef: 'shared-b', providerType: 'openai' }, 'user-1');

    // Nothing should have fired yet — it's still debounced.
    expect(fetchMock.calls).toHaveLength(0);

    await flushUserPreferencesSync();

    expect(fetchMock.calls).toHaveLength(1);
    const { url, init } = fetchMock.calls[0];
    expect(url).toContain('/api/user/state/preferences');
    expect(init?.method).toBe('PUT');
    const body = JSON.parse(String(init?.body));
    expect(body.patch.providerRef).toBe('shared-b');
    expect(body.patch.providerType).toBe('openai');

    // The debounce timer must not also fire a duplicate request afterwards.
    await vi.runAllTimersAsync();
    expect(fetchMock.calls).toHaveLength(1);
  });

  test('is a no-op when there is no pending patch', async () => {
    const fetchMock = installFetchMock(okResponse);
    await flushUserPreferencesSync();
    expect(fetchMock.calls).toHaveLength(0);
  });

  test('rejects when the server write fails so callers can surface the error', async () => {
    installFetchMock(() => new Response(JSON.stringify({ error: 'boom' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    }));

    scheduleUserPreferencesSync({ providerRef: 'shared-b' }, 'user-1');

    await expect(flushUserPreferencesSync()).rejects.toThrow();
  });
});
