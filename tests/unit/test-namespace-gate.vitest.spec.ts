import { describe, expect, test } from 'vitest';
import { getOpenReaderTestNamespace } from '../../src/lib/server/testing/test-namespace';
import { withEnv } from './support/env';

function headers(value: string): Headers {
  return new Headers({ 'x-openreader-test-namespace': value });
}

function cookieHeaders(value: string): Headers {
  return new Headers({ cookie: `other=value; x-openreader-test-namespace=${value}` });
}

describe('getOpenReaderTestNamespace gate', () => {
  test('honored in non-production builds', async () => {
    await withEnv({ NODE_ENV: 'development', ENABLE_TEST_NAMESPACE: undefined }, () => {
      expect(getOpenReaderTestNamespace(headers('chromium'))).toBe('chromium');
    });
  });

  test('ignored on production builds without the explicit flag', async () => {
    await withEnv({ NODE_ENV: 'production', ENABLE_TEST_NAMESPACE: undefined }, () => {
      expect(getOpenReaderTestNamespace(headers('attacker'))).toBeNull();
    });
  });

  test('honored on production builds when ENABLE_TEST_NAMESPACE=true (CI parity)', async () => {
    await withEnv({ NODE_ENV: 'production', ENABLE_TEST_NAMESPACE: 'true' }, () => {
      expect(getOpenReaderTestNamespace(headers('webkit'))).toBe('webkit');
    });
  });

  test('accepts the test cookie used by native browser downloads', async () => {
    await withEnv({ NODE_ENV: 'production', ENABLE_TEST_NAMESPACE: 'true' }, () => {
      expect(getOpenReaderTestNamespace(cookieHeaders('webkit-w1-r0'))).toBe('webkit-w1-r0');
    });
  });

  test('prefers the request header over the native-download cookie', async () => {
    await withEnv({ NODE_ENV: 'production', ENABLE_TEST_NAMESPACE: 'true' }, () => {
      const requestHeaders = cookieHeaders('cookie-namespace');
      requestHeaders.set('x-openreader-test-namespace', 'header-namespace');
      expect(getOpenReaderTestNamespace(requestHeaders)).toBe('header-namespace');
    });
  });

  test('ignores the test cookie in production without the explicit flag', async () => {
    await withEnv({ NODE_ENV: 'production', ENABLE_TEST_NAMESPACE: undefined }, () => {
      expect(getOpenReaderTestNamespace(cookieHeaders('webkit'))).toBeNull();
    });
  });
});
