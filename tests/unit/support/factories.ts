import type { ServerErrorClass, ServerErrorContext } from '../../../src/lib/server/errors/contract';

export function makeServerAppErrorInput(overrides: Partial<{
  code: string;
  message: string;
  errorClass: ServerErrorClass;
  httpStatus: number;
  retryable: boolean;
  details: Record<string, unknown>;
  cause: unknown;
}> = {}) {
  return {
    code: 'UNKNOWN_SERVER_ERROR',
    message: 'Unhandled server failure',
    errorClass: 'unknown' as const,
    ...overrides,
  };
}

export function makeServerErrorContext(overrides: ServerErrorContext = {}): ServerErrorContext {
  return {
    code: 'UNKNOWN_SERVER_ERROR',
    errorClass: 'unknown',
    ...overrides,
  };
}

export function makeSharedProviders(slugs: readonly string[]): Array<{ slug: string }> {
  return slugs.map((slug) => ({ slug }));
}
