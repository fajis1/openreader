import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  selectExisting: vi.fn(async () => [] as unknown[]),
  writeRequest: vi.fn(async () => undefined),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock('@/db', () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: mocks.selectExisting,
        })),
      })),
    })),
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        onConflictDoUpdate: mocks.writeRequest,
      })),
    })),
  },
}));

vi.mock('@/lib/server/admin/settings', () => ({
  getRuntimeConfig: vi.fn(),
  setRuntimeConfigKey: vi.fn(),
}));

vi.mock('@/lib/server/logger', () => ({
  serverLogger: {
    info: mocks.info,
    warn: mocks.warn,
    error: mocks.error,
  },
}));

import { createJoinRequest } from '../../src/lib/server/access/join-requests';

const EMAIL_ENV_KEYS = [
  'RESEND_API_KEY',
  'JOIN_REQUEST_FROM_EMAIL',
  'JOIN_REQUEST_ADMIN_EMAIL',
  'ADMIN_EMAILS',
] as const;

function clearEmailEnvironment(): void {
  for (const key of EMAIL_ENV_KEYS) vi.stubEnv(key, '');
}

function serializedLogs(): string {
  return JSON.stringify([
    ...mocks.info.mock.calls,
    ...mocks.warn.mock.calls,
    ...mocks.error.mock.calls,
  ]);
}

function expectNoDecisionCredentialInLogs(input: {
  approveUrl: string;
  denyUrl: string;
}): void {
  const token = new URL(input.approveUrl).searchParams.get('token');
  expect(token).toBeTruthy();

  const logs = serializedLogs();
  expect(logs).not.toContain(token);
  expect(logs).not.toContain(input.approveUrl);
  expect(logs).not.toContain(input.denyUrl);
  expect(logs).not.toContain('token=');
  expect(logs).not.toContain('approveUrl');
  expect(logs).not.toContain('denyUrl');
}

async function submitJoinRequest() {
  return createJoinRequest({
    email: 'Reader@Example.com',
    name: 'Test Reader',
    intendedUse: 'Listen to scholarly books while commuting.',
    heardAbout: 'A colleague',
    requestUrl: 'https://reader.example.com/signup',
  });
}

describe('join-request log credential boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    clearEmailEnvironment();
    mocks.selectExisting.mockResolvedValue([]);
    mocks.writeRequest.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  test('does not log decision credentials when email configuration is missing', async () => {
    const result = await submitJoinRequest();

    expectNoDecisionCredentialInLogs(result);
    expect(mocks.info).toHaveBeenCalledWith(expect.objectContaining({
      event: 'join_request.notification.skipped',
      requestId: result.request.id,
      email: 'reader@example.com',
      reason: 'missing_email_configuration',
    }), expect.any(String));
  });

  test('does not log decision credentials when email delivery fails', async () => {
    vi.stubEnv('RESEND_API_KEY', 'test-resend-key');
    vi.stubEnv('JOIN_REQUEST_FROM_EMAIL', 'OpenReader <access@reader.example.com>');
    vi.stubEnv('JOIN_REQUEST_ADMIN_EMAIL', 'admin@example.com');
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      throw new Error(`Simulated delivery failure containing request body: ${String(init?.body)}`);
    }));

    const result = await submitJoinRequest();

    expectNoDecisionCredentialInLogs(result);
    expect(mocks.warn).toHaveBeenCalledWith(expect.objectContaining({
      event: 'join_request.notification.failed',
      requestId: result.request.id,
      email: 'reader@example.com',
      reason: 'resend_request_failed',
    }), expect.any(String));
    expect(serializedLogs()).not.toContain('Simulated delivery failure');
  });

  test('logs only the HTTP status category when Resend rejects delivery', async () => {
    vi.stubEnv('RESEND_API_KEY', 'test-resend-key');
    vi.stubEnv('JOIN_REQUEST_FROM_EMAIL', 'OpenReader <access@reader.example.com>');
    vi.stubEnv('JOIN_REQUEST_ADMIN_EMAIL', 'admin@example.com');
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 503 })));

    const result = await submitJoinRequest();

    expectNoDecisionCredentialInLogs(result);
    expect(mocks.warn).toHaveBeenCalledWith(expect.objectContaining({
      event: 'join_request.notification.failed',
      requestId: result.request.id,
      email: 'reader@example.com',
      reason: 'resend_http_503',
    }), expect.any(String));
  });
});
