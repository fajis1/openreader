import { createHash, randomUUID } from 'node:crypto';
import type { NextRequest } from 'next/server';
import pino, { type Logger } from 'pino';
import pinoPretty from 'pino-pretty';

export type ServerLogger = Logger;
export type ServerLogLevel = 'error' | 'warn' | 'info';

export type ServerErrorClass =
  | 'validation'
  | 'auth'
  | 'permission'
  | 'upstream'
  | 'storage'
  | 'db'
  | 'timeout'
  | 'unknown';

export type ServerErrorContract = {
  errorCode: string;
  errorClass: ServerErrorClass;
  retryable: boolean;
  httpStatus: number;
  operation: string;
  degraded: boolean;
  cause?: unknown;
};

export type ServerApiErrorBody = {
  error: string;
  errorCode: string;
  retryable?: boolean;
  details?: Record<string, unknown>;
};

const LOG_FORMAT = process.env.LOG_FORMAT?.trim().toLowerCase() || 'pretty';
const LOG_LEVEL = process.env.LOG_LEVEL?.trim() || 'info';

function buildLoggerConfig(): pino.LoggerOptions {
  return {
    level: LOG_LEVEL,
    base: undefined,
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level(label) {
        return { level: label };
      },
    },
  };
}

function createServerLogger(): ServerLogger {
  const config = buildLoggerConfig();
  if (LOG_FORMAT === 'json') {
    return pino(config);
  }

  const prettyStream = pinoPretty({
    colorize: true,
    translateTime: 'SYS:standard',
    ignore: 'pid,hostname',
  });
  return pino(config, prettyStream);
}

export const serverLogger: ServerLogger = createServerLogger();

export function errorToLog(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }
  return { message: String(error) };
}

export function apiErrorBody(
  input: Omit<ServerApiErrorBody, 'errorCode'> & { errorCode: string },
): ServerApiErrorBody {
  return {
    error: input.error,
    errorCode: input.errorCode,
    ...(typeof input.retryable === 'boolean' ? { retryable: input.retryable } : {}),
    ...(input.details ? { details: input.details } : {}),
  };
}

export function hashForLog(value: string | null | undefined): string | null {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) return null;
  return createHash('sha256').update(normalized).digest('hex').slice(0, 12);
}

export function getRequestId(request: NextRequest): string {
  const fromHeader = request.headers.get('x-request-id')
    || request.headers.get('x-vercel-id');
  const normalized = fromHeader?.trim();
  return normalized || randomUUID();
}

export function createRequestLogger(input: {
  route: string;
  request: NextRequest;
  requestId?: string;
  fields?: Record<string, unknown>;
}): { logger: ServerLogger; requestId: string } {
  const requestId = input.requestId || getRequestId(input.request);
  const logger = serverLogger.child({
    route: input.route,
    method: input.request.method,
    requestId,
    ...(input.fields || {}),
  });
  return { logger, requestId };
}
