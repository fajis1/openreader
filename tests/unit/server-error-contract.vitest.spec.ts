import { describe, expect, test } from 'vitest';
import {
  ServerAppError,
  createServerAppError,
  isServerAppError,
  normalizeServerError,
  toApiErrorBody,
  toHttpStatus,
} from '../../src/lib/server/errors/contract';
import { makeServerAppErrorInput } from './support/factories';

describe('server error contract', () => {
  test('normalizes unknown throwable to fallback shape', () => {
    const normalized = normalizeServerError('boom');

    expect(normalized.code).toBe('UNKNOWN_SERVER_ERROR');
    expect(normalized.errorClass).toBe('unknown');
    expect(normalized.httpStatus).toBe(500);
    expect(normalized.retryable).toBe(false);
    expect(normalized.message).toBe('boom');
  });

  test('preserves ServerAppError metadata', () => {
    const err = createServerAppError(makeServerAppErrorInput({
      code: 'USER_PROGRESS_UPDATE_FAILED',
      message: 'Failed to update progress',
      errorClass: 'db',
      retryable: true,
      httpStatus: 500,
      details: { operation: 'update_progress' },
    }));

    const normalized = normalizeServerError(err);

    expect(isServerAppError(err)).toBe(true);
    expect(normalized.code).toBe('USER_PROGRESS_UPDATE_FAILED');
    expect(normalized.errorClass).toBe('db');
    expect(normalized.httpStatus).toBe(500);
    expect(normalized.retryable).toBe(true);
    expect(normalized.details?.operation).toBe('update_progress');
  });

  test('normalizes partially-shaped thrown errors with code sanitization', () => {
    const thrown = Object.assign(new Error('Timed out waiting for storage read'), {
      code: 'not_valid_code',
      errorClass: 'timeout',
      httpStatus: 604,
      retryable: true,
    });

    const normalized = normalizeServerError(thrown);

    expect(normalized.code).toBe('UNKNOWN_SERVER_ERROR');
    expect(normalized.errorClass).toBe('timeout');
    expect(normalized.httpStatus).toBe(599);
    expect(normalized.retryable).toBe(true);
  });

  test('maps normalized errors to API body + status', () => {
    const normalized = normalizeServerError(
      new ServerAppError({
        code: 'UPSTREAM_TTS_ERROR',
        message: 'Upstream failure',
        errorClass: 'upstream',
      }),
    );

    const body = toApiErrorBody(normalized, { includeDetails: false });

    expect(body).toEqual({
      error: 'Upstream failure',
      errorCode: 'UPSTREAM_TTS_ERROR',
      retryable: true,
    });
    expect(toHttpStatus(normalized)).toBe(502);
  });

  test('rejects invalid server error code at creation boundary', () => {
    expect(() => createServerAppError(makeServerAppErrorInput({
      code: 'bad-code',
      message: 'Invalid',
      errorClass: 'validation',
    }))).toThrow(/Invalid ServerAppError code/i);
  });
});
