import { expect, test } from 'vitest';
import { readJsonResponse } from '@/lib/client/read-json-response';
test('reports proxy HTML with HTTP status and recovery advice, not a JSON parse exception', async () => {
  await expect(readJsonResponse(new Response('<html>private upstream details</html>', { status: 504 }))).rejects.toThrow('HTTP 504');
  await expect(readJsonResponse(new Response('<html>private upstream details</html>', { status: 502 }))).rejects.not.toThrow('private upstream details');
});
test('preserves safe application errors and diagnostic references', async () => {
  await expect(readJsonResponse(Response.json({ error: 'Repair failed', requestId: 'reference' }, { status: 409 }))).rejects.toThrow('Repair failed Reference: reference');
  expect(await readJsonResponse(Response.json({ jobId: 'queued' }, { status: 202 }))).toEqual({ jobId: 'queued' });
});
