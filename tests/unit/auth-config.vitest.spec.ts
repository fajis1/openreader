import { describe, expect, test } from 'vitest';
import { getAuthBaseUrl, isAnonymousAuthSessionsEnabled, isAuthEnabled, isGithubAuthEnabled } from '../../src/lib/server/auth/config';
import { withEnv } from './support/env';

describe('auth config contract', () => {
  test('auth is enabled only when AUTH_SECRET and BASE_URL are both set', async () => {
    await withEnv(
      {
        AUTH_SECRET: undefined,
        BASE_URL: undefined,
      },
      async () => {
        expect(isAuthEnabled()).toBe(false);
        expect(getAuthBaseUrl()).toBeNull();
      },
    );

    await withEnv(
      {
        AUTH_SECRET: 'unit-secret',
        BASE_URL: 'http://localhost:3003',
      },
      async () => {
        expect(isAuthEnabled()).toBe(true);
        expect(getAuthBaseUrl()).toBe('http://localhost:3003');
      },
    );
  });

  test.each([
    { envValue: undefined, expected: false },
    { envValue: 'true', expected: true },
    { envValue: 'false', expected: false },
    { envValue: '1', expected: false },
    { envValue: 'TRUE', expected: true },
  ])(
    'anonymous sessions honor strict boolean parsing when auth is enabled (value: $envValue)',
    async ({ envValue, expected }) => {
      await withEnv(
        {
          AUTH_SECRET: 'unit-secret',
          BASE_URL: 'http://localhost:3003',
          USE_ANONYMOUS_AUTH_SESSIONS: envValue,
        },
        async () => {
          expect(isAnonymousAuthSessionsEnabled()).toBe(expected);
        },
      );
    },
  );

  test('anonymous sessions are always disabled when auth is disabled', async () => {
    await withEnv(
      {
        AUTH_SECRET: undefined,
        BASE_URL: undefined,
        USE_ANONYMOUS_AUTH_SESSIONS: 'true',
      },
      async () => {
        expect(isAnonymousAuthSessionsEnabled()).toBe(false);
      },
    );
  });

  test.each([
    {
      title: 'returns false when auth is disabled',
      env: {
        AUTH_SECRET: undefined,
        BASE_URL: undefined,
        GITHUB_CLIENT_ID: 'id',
        GITHUB_CLIENT_SECRET: 'secret',
      },
      expected: false,
    },
    {
      title: 'returns false when GitHub client id is missing',
      env: {
        AUTH_SECRET: 'unit-secret',
        BASE_URL: 'http://localhost:3003',
        GITHUB_CLIENT_ID: undefined,
        GITHUB_CLIENT_SECRET: 'secret',
      },
      expected: false,
    },
    {
      title: 'returns false when GitHub client secret is missing',
      env: {
        AUTH_SECRET: 'unit-secret',
        BASE_URL: 'http://localhost:3003',
        GITHUB_CLIENT_ID: 'id',
        GITHUB_CLIENT_SECRET: undefined,
      },
      expected: false,
    },
    {
      title: 'returns true when auth is enabled and GitHub credentials are present',
      env: {
        AUTH_SECRET: 'unit-secret',
        BASE_URL: 'http://localhost:3003',
        GITHUB_CLIENT_ID: 'id',
        GITHUB_CLIENT_SECRET: 'secret',
      },
      expected: true,
    },
  ])('$title', async ({ env, expected }) => {
    await withEnv(env, async () => {
      expect(isGithubAuthEnabled()).toBe(expected);
    });
  });
});
