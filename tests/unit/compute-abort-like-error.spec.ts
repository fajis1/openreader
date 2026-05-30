import { expect, test } from '@playwright/test';
import { isAbortLikeError } from '../../src/lib/server/compute/abort-like-error';

test.describe('isAbortLikeError', () => {
  test('matches abort-shaped errors', () => {
    expect(isAbortLikeError(new DOMException('This operation was aborted', 'AbortError'))).toBe(true);
    expect(isAbortLikeError(Object.assign(new Error('random'), { name: 'AbortError' }))).toBe(true);
    expect(isAbortLikeError(new Error('This operation was aborted'))).toBe(true);
    expect(isAbortLikeError({ name: 'AbortError' })).toBe(true);
  });

  test('does not match non-abort errors', () => {
    expect(isAbortLikeError(new Error('boom'))).toBe(false);
    expect(isAbortLikeError({ name: 'TypeError' })).toBe(false);
    expect(isAbortLikeError(null)).toBe(false);
    expect(isAbortLikeError(undefined)).toBe(false);
  });
});
