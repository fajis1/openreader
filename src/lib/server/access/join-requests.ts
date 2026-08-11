import { createHash, randomBytes } from 'node:crypto';
import { eq, like } from 'drizzle-orm';
import { db } from '@/db';
import { adminSettings } from '@/db/schema';
import { getRuntimeConfig, setRuntimeConfigKey } from '@/lib/server/admin/settings';
import { serverLogger } from '@/lib/server/logger';
import { tryGetOrigin } from '@/lib/shared/urls';

type JoinRequestStatus = 'pending' | 'approved' | 'denied';

export type JoinRequest = {
  id: string;
  email: string;
  name: string | null;
  intendedUse: string;
  heardAbout: string;
  status: JoinRequestStatus;
  createdAt: number;
  updatedAt: number;
  decidedAt: number | null;
  decisionNote: string | null;
  tokenHash: string;
};

const JOIN_REQUEST_PREFIX = 'join_request:';
const RESEND_API_URL = 'https://api.resend.com/emails';

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function parseStoredValue(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function serializeForStorage(value: unknown): unknown {
  return JSON.stringify(value);
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function safeText(value: unknown, maxLength: number): string {
  return String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, maxLength);
}

function requestKey(email: string): string {
  return `${JOIN_REQUEST_PREFIX}${normalizeEmail(email)}`;
}

function parseJoinRequest(value: unknown): JoinRequest | null {
  const parsed = parseStoredValue(value);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const rec = parsed as Record<string, unknown>;
  if (
    typeof rec.id !== 'string'
    || typeof rec.email !== 'string'
    || typeof rec.intendedUse !== 'string'
    || typeof rec.heardAbout !== 'string'
    || typeof rec.status !== 'string'
    || typeof rec.createdAt !== 'number'
    || typeof rec.updatedAt !== 'number'
    || typeof rec.tokenHash !== 'string'
  ) {
    return null;
  }
  if (!['pending', 'approved', 'denied'].includes(rec.status)) return null;
  return {
    id: rec.id,
    email: normalizeEmail(rec.email),
    name: typeof rec.name === 'string' && rec.name.trim() ? rec.name.trim() : null,
    intendedUse: rec.intendedUse,
    heardAbout: rec.heardAbout,
    status: rec.status as JoinRequestStatus,
    createdAt: rec.createdAt,
    updatedAt: rec.updatedAt,
    decidedAt: typeof rec.decidedAt === 'number' ? rec.decidedAt : null,
    decisionNote: typeof rec.decisionNote === 'string' && rec.decisionNote.trim() ? rec.decisionNote : null,
    tokenHash: rec.tokenHash,
  };
}

async function writeJoinRequest(request: JoinRequest): Promise<void> {
  await db.insert(adminSettings).values({
    key: requestKey(request.email),
    valueJson: serializeForStorage(request),
    source: 'admin',
    updatedAt: Date.now(),
  }).onConflictDoUpdate({
    target: adminSettings.key,
    set: {
      valueJson: serializeForStorage(request),
      updatedAt: Date.now(),
    },
  });
}

export async function createJoinRequest(input: {
  email: string;
  name?: unknown;
  intendedUse: unknown;
  heardAbout: unknown;
  requestUrl: string;
}): Promise<{ request: JoinRequest; approveUrl: string; denyUrl: string }> {
  const email = normalizeEmail(input.email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('Enter a valid email address.');
  }
  const intendedUse = safeText(input.intendedUse, 1000);
  const heardAbout = safeText(input.heardAbout, 500);
  if (intendedUse.length < 10) throw new Error('Tell us briefly what you plan to use OpenReader for.');
  if (heardAbout.length < 2) throw new Error('Tell us how you heard about OpenReader.');

  const existingRows = await db.select().from(adminSettings).where(eq(adminSettings.key, requestKey(email))).limit(1);
  const existing = parseJoinRequest(existingRows[0]?.valueJson);
  const token = randomBytes(32).toString('base64url');
  const now = Date.now();
  const request: JoinRequest = {
    id: existing?.id ?? randomBytes(12).toString('hex'),
    email,
    name: safeText(input.name, 160) || null,
    intendedUse,
    heardAbout,
    status: 'pending',
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    decidedAt: null,
    decisionNote: null,
    tokenHash: hashToken(token),
  };
  await writeJoinRequest(request);

  const origin = tryGetOrigin(process.env.BASE_URL) ?? new URL(input.requestUrl).origin;
  const approveUrl = `${origin}/api/join-requests/decision?token=${encodeURIComponent(token)}&decision=approve`;
  const denyUrl = `${origin}/api/join-requests/decision?token=${encodeURIComponent(token)}&decision=deny`;

  serverLogger.info({
    event: 'join_request.created',
    email,
    approveUrl,
    denyUrl,
  }, 'Join request created; approve/deny URLs generated');
  await notifyAdminsOfJoinRequest({ request, approveUrl, denyUrl });

  return { request, approveUrl, denyUrl };
}

async function notifyAdminsOfJoinRequest(input: {
  request: JoinRequest;
  approveUrl: string;
  denyUrl: string;
}): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const to = process.env.JOIN_REQUEST_ADMIN_EMAIL?.trim() || process.env.ADMIN_EMAILS?.split(',')[0]?.trim();
  const from = process.env.JOIN_REQUEST_FROM_EMAIL?.trim();
  if (!apiKey || !to || !from) {
    serverLogger.info({
      event: 'join_request.notification.skipped',
      reason: 'missing_email_configuration',
      email: input.request.email,
      approveUrl: input.approveUrl,
      denyUrl: input.denyUrl,
    }, 'Join request email not sent; configure RESEND_API_KEY, JOIN_REQUEST_FROM_EMAIL, and JOIN_REQUEST_ADMIN_EMAIL to receive approval links by email.');
    return;
  }

  try {
    const response = await fetch(RESEND_API_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to,
        subject: `OpenReader access request: ${input.request.email}`,
        text: [
          `OpenReader access request from ${input.request.email}`,
          input.request.name ? `Name: ${input.request.name}` : null,
          '',
          'Plans:',
          input.request.intendedUse,
          '',
          'Heard about it:',
          input.request.heardAbout,
          '',
          `Approve: ${input.approveUrl}`,
          `Deny: ${input.denyUrl}`,
        ].filter((line) => line !== null).join('\n'),
      }),
    });
    if (!response.ok) {
      throw new Error(`Resend returned HTTP ${response.status}`);
    }
  } catch (error) {
    serverLogger.warn({
      event: 'join_request.notification.failed',
      email: input.request.email,
      approveUrl: input.approveUrl,
      denyUrl: input.denyUrl,
      error,
    }, 'Failed to send join request notification email.');
  }
}

export async function decideJoinRequest(input: {
  token: string;
  decision: 'approve' | 'deny';
}): Promise<JoinRequest | null> {
  const tokenHash = hashToken(input.token);
  const rows = await db.select().from(adminSettings).where(like(adminSettings.key, `${JOIN_REQUEST_PREFIX}%`));
  const requests: Array<JoinRequest | null> = (rows as Array<{ valueJson: unknown }>)
    .map((row) => parseJoinRequest(row.valueJson));
  const match = requests.find((request): request is JoinRequest => Boolean(request && request.tokenHash === tokenHash));
  if (!match) return null;

  const now = Date.now();
  const next: JoinRequest = {
    ...match,
    status: input.decision === 'approve' ? 'approved' : 'denied',
    updatedAt: now,
    decidedAt: now,
  };
  await writeJoinRequest(next);

  if (input.decision === 'approve') {
    const runtime = await getRuntimeConfig();
    const allowedEmails = Array.from(new Set([...runtime.allowedEmails, next.email])).sort();
    await setRuntimeConfigKey('allowedEmails', allowedEmails);
  }

  return next;
}
