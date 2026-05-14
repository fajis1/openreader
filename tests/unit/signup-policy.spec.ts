import { expect, test } from '@playwright/test';

import { RUNTIME_CONFIG_SCHEMA } from '../../src/lib/server/admin/settings';
import { assertUserSignupAllowed } from '../../src/lib/server/auth/signup-policy';

test.describe('enableUserSignups runtime config', () => {
  test('defaults to enabled', () => {
    expect(RUNTIME_CONFIG_SCHEMA.enableUserSignups.default).toBe(true);
  });

  test('parses first-boot env seed values', () => {
    expect(RUNTIME_CONFIG_SCHEMA.enableUserSignups.parseEnv('true')).toBe(true);
    expect(RUNTIME_CONFIG_SCHEMA.enableUserSignups.parseEnv('false')).toBe(false);
    expect(RUNTIME_CONFIG_SCHEMA.enableUserSignups.parseEnv('1')).toBe(true);
    expect(RUNTIME_CONFIG_SCHEMA.enableUserSignups.parseEnv('0')).toBe(false);
  });
});

test.describe('signup policy enforcement', () => {
  test('allows new non-anonymous users when signups are enabled', () => {
    expect(() => assertUserSignupAllowed({ enableUserSignups: true, isAnonymous: false })).not.toThrow();
  });

  test('blocks new non-anonymous users when signups are disabled', () => {
    expect(() => assertUserSignupAllowed({ enableUserSignups: false, isAnonymous: false })).toThrow(
      /sign-ups are disabled/i,
    );
  });

  test('does not block anonymous-session user creation when signups are disabled', () => {
    expect(() => assertUserSignupAllowed({ enableUserSignups: false, isAnonymous: true })).not.toThrow();
  });
});
