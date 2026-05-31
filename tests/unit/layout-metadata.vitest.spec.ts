import { describe, expect, test } from 'vitest';
import { tryGetOrigin } from '../../src/lib/shared/urls';

describe('tryGetOrigin utility function', () => {
  test('returns null for undefined, null, or empty string', () => {
    expect(tryGetOrigin(undefined)).toBeNull();
    expect(tryGetOrigin('')).toBeNull();
  });

  test('extracts origin from valid HTTP/HTTPS URLs', () => {
    expect(tryGetOrigin('http://localhost:3000')).toBe('http://localhost:3000');
    expect(tryGetOrigin('https://openreader.richardr.dev')).toBe('https://openreader.richardr.dev');
    expect(tryGetOrigin('https://my-custom-domain.com/some/path?query=1')).toBe('https://my-custom-domain.com');
  });

  test('returns null for malformed URLs/strings without protocols', () => {
    expect(tryGetOrigin('malformed-url')).toBeNull();
    expect(tryGetOrigin('localhost:3000')).toBeNull();
    expect(tryGetOrigin('my-custom-domain.com')).toBeNull();
  });

  test('returns null for invalid protocols/schemes', () => {
    expect(tryGetOrigin('ftp://some-server.com')).toBe('ftp://some-server.com'); // standard URL supports ftp
    expect(tryGetOrigin('invalid://foo')).toBeNull(); // non-standard/unsupported origins return null
    expect(tryGetOrigin('http://[invalid-ipv6]')).toBeNull();
  });
});
