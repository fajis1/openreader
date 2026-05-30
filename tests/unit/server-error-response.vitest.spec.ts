import { describe, expect, test } from 'vitest';
import { createServerAppError } from '../../src/lib/server/errors/contract';
import { asRouteErrorContext, errorResponse, withErrorBoundary } from '../../src/lib/server/errors/next-response';
import { createServerLoggerStub } from './support/server-stubs';
import { makeServerAppErrorInput } from './support/factories';

describe('server error response helper', () => {
  test('returns mapped 4xx response with explicit app code', async () => {
    const response = errorResponse(
      createServerAppError(makeServerAppErrorInput({
        code: 'AUTH_UNAUTHORIZED',
        message: 'Unauthorized',
        errorClass: 'auth',
        httpStatus: 401,
        retryable: false,
      })),
      {
        apiErrorMessage: 'Unauthorized',
      },
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: 'Unauthorized',
      errorCode: 'AUTH_UNAUTHORIZED',
      retryable: false,
    });
  });

  test('normalizes unknown errors to safe 500 without stack leakage', async () => {
    const response = errorResponse(new Error('sensitive internal details'), {
      apiErrorMessage: 'Internal Server Error',
      normalize: { code: 'UNKNOWN_SERVER_ERROR', errorClass: 'unknown' },
    });
    const body = await response.json();
    expect(response.status).toBe(500);
    expect(body).toEqual({
      error: 'Internal Server Error',
      errorCode: 'UNKNOWN_SERVER_ERROR',
      retryable: false,
    });
    expect(JSON.stringify(body)).not.toContain('stack');
    expect(JSON.stringify(body)).not.toContain('cause');
  });

  test('withErrorBoundary returns normalized error response and emits a structured log', async () => {
    const logger = createServerLoggerStub();
    const handler = withErrorBoundary(
      async () => {
        throw new Error('storage dependency timed out');
      },
      {
        route: '/api/unit-test',
        logger: logger as never,
        event: 'unit_test.route.failed',
        msg: 'Route failed',
        normalize: {
          code: 'DOCUMENT_BLOB_FETCH_FAILED',
          errorClass: 'storage',
        },
        apiErrorMessage: 'Failed to fetch document blob',
      },
    );

    const response = await handler();
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toEqual({
      error: 'Failed to fetch document blob',
      errorCode: 'DOCUMENT_BLOB_FETCH_FAILED',
      retryable: true,
    });
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  test('asRouteErrorContext derives method and request id consistently', () => {
    const context = asRouteErrorContext({
      request: { method: 'PATCH' } as never,
      route: '/api/runtime-config',
      requestId: 'req-123',
    });

    expect(context).toEqual({
      route: '/api/runtime-config',
      method: 'PATCH',
      requestId: 'req-123',
    });
  });
});
