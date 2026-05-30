import type { Mock } from 'vitest';
import { vi } from 'vitest';

export interface ServerLoggerStub {
  child: Mock;
  debug: Mock;
  error: Mock;
  info: Mock;
  warn: Mock;
}

export function createServerLoggerStub(): ServerLoggerStub {
  const logger = {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    child: vi.fn(),
  } as ServerLoggerStub;
  logger.child.mockReturnValue(logger);
  return logger;
}
