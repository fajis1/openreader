import { beforeEach, describe, expect, test, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  requireAdminContext: vi.fn(),
  listSupportUsers: vi.fn(),
  listSupportPayments: vi.fn(),
  listSupportAudit: vi.fn(),
  grantSupportCredits: vi.fn(),
  updateSupportJob: vi.fn(),
}));

vi.mock('@/lib/server/auth/admin', () => ({
  requireAdminContext: mocks.requireAdminContext,
}));

vi.mock('@/lib/server/admin/support', () => ({
  listSupportUsers: mocks.listSupportUsers,
  listSupportPayments: mocks.listSupportPayments,
  listSupportAudit: mocks.listSupportAudit,
  grantSupportCredits: mocks.grantSupportCredits,
  updateSupportJob: mocks.updateSupportJob,
}));

describe('admin support routes', () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset();
    mocks.requireAdminContext.mockResolvedValue({
      userId: 'admin-1',
      user: { id: 'admin-1', isAdmin: true },
    });
    mocks.listSupportUsers.mockResolvedValue({ users: [], page: 1, pageSize: 30, total: 0, totalPages: 1 });
    mocks.listSupportPayments.mockResolvedValue({ payments: [], page: 1, pageSize: 50, total: 0, totalPages: 1 });
    mocks.listSupportAudit.mockResolvedValue({ events: [], page: 1, pageSize: 50, total: 0, totalPages: 1 });
    mocks.grantSupportCredits.mockResolvedValue({ available: 5, grantedTotal: 5, consumedTotal: 0 });
    mocks.updateSupportJob.mockResolvedValue({ id: 'job-1', status: 'queued' });
  });

  test('returns the authorization response without reading user data', async () => {
    const denied = new Response('Forbidden', { status: 403 });
    mocks.requireAdminContext.mockResolvedValue(denied);
    const { GET } = await import('../../src/app/api/admin/support/users/route');

    const response = await GET(new NextRequest('http://localhost/api/admin/support/users'));

    expect(response).toBe(denied);
    expect(mocks.listSupportUsers).not.toHaveBeenCalled();
  });

  test('attributes a credit grant to the signed-in administrator', async () => {
    const { POST } = await import('../../src/app/api/admin/support/users/[id]/credits/route');
    const response = await POST(new NextRequest('http://localhost/api/admin/support/users/user-2/credits', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ credits: 5, note: '$10 PayPal support', idempotencyKey: 'grant-1' }),
    }), { params: Promise.resolve({ id: 'user-2' }) });

    expect(response.status).toBe(200);
    expect(mocks.grantSupportCredits).toHaveBeenCalledWith({
      adminUserId: 'admin-1',
      targetUserId: 'user-2',
      credits: 5,
      note: '$10 PayPal support',
      idempotencyKey: 'grant-1',
    });
  });

  test('protects and filters the PayPal payment ledger', async () => {
    const { GET } = await import('../../src/app/api/admin/support/payments/route');
    const response = await GET(new NextRequest('http://localhost/api/admin/support/payments?status=review_required&q=user%40test&page=2'));

    expect(response.status).toBe(200);
    expect(mocks.listSupportPayments).toHaveBeenCalledWith({
      status: 'review_required',
      query: 'user@test',
      page: 2,
      pageSize: 50,
    });
  });

  test('paginates the durable administrator audit ledger', async () => {
    const { GET } = await import('../../src/app/api/admin/support/audit/route');
    const response = await GET(new NextRequest('http://localhost/api/admin/support/audit?page=3&pageSize=25'));

    expect(response.status).toBe(200);
    expect(mocks.listSupportAudit).toHaveBeenCalledWith({ page: 3, pageSize: 25 });
  });

  test('rejects unsafe job actions before changing a job', async () => {
    const { PATCH } = await import('../../src/app/api/admin/support/jobs/[id]/route');
    const response = await PATCH(new NextRequest('http://localhost/api/admin/support/jobs/job-1', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'delete' }),
    }), { params: Promise.resolve({ id: 'job-1' }) });

    expect(response.status).toBe(400);
    expect(mocks.updateSupportJob).not.toHaveBeenCalled();
  });

  test('allows an administrator to retry a failed job', async () => {
    const { PATCH } = await import('../../src/app/api/admin/support/jobs/[id]/route');
    const response = await PATCH(new NextRequest('http://localhost/api/admin/support/jobs/job-1', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: 'retry', note: 'Provider recovered' }),
    }), { params: Promise.resolve({ id: 'job-1' }) });

    expect(response.status).toBe(200);
    expect(mocks.updateSupportJob).toHaveBeenCalledWith({
      adminUserId: 'admin-1',
      jobId: 'job-1',
      action: 'retry',
      note: 'Provider recovered',
    });
  });
});
