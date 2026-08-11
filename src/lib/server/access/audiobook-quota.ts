import { and, count, eq, gte } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { db } from '@/db';
import { adminSettings, audiobookJobs } from '@/db/schema';
import { getRuntimeConfig } from '@/lib/server/admin/settings';

export type AudiobookCreditLedger = {
  userId: string;
  available: number;
  grantedTotal: number;
  consumedTotal: number;
  updatedAt: number;
  grants: Array<{
    id: string;
    credits: number;
    note: string | null;
    createdAt: number;
  }>;
  consumptions: Array<{
    id: string;
    jobId: string;
    createdAt: number;
  }>;
};

const CREDIT_PREFIX = 'audiobook_extra_credits:';

function creditKey(userId: string): string {
  return `${CREDIT_PREFIX}${userId}`;
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

function parseLedger(userId: string, value: unknown): AudiobookCreditLedger {
  const parsed = parseStoredValue(value);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return emptyLedger(userId);
  }
  const rec = parsed as Record<string, unknown>;
  return {
    userId,
    available: Math.max(0, Math.floor(Number(rec.available ?? 0))),
    grantedTotal: Math.max(0, Math.floor(Number(rec.grantedTotal ?? 0))),
    consumedTotal: Math.max(0, Math.floor(Number(rec.consumedTotal ?? 0))),
    updatedAt: Number(rec.updatedAt ?? Date.now()),
    grants: Array.isArray(rec.grants)
      ? rec.grants.flatMap((grant) => {
        if (!grant || typeof grant !== 'object') return [];
        const g = grant as Record<string, unknown>;
        const credits = Math.floor(Number(g.credits ?? 0));
        if (typeof g.id !== 'string' || credits < 1 || typeof g.createdAt !== 'number') return [];
        return [{
          id: g.id,
          credits,
          note: typeof g.note === 'string' && g.note.trim() ? g.note.trim() : null,
          createdAt: g.createdAt,
        }];
      })
      : [],
    consumptions: Array.isArray(rec.consumptions)
      ? rec.consumptions.flatMap((consumption) => {
        if (!consumption || typeof consumption !== 'object') return [];
        const c = consumption as Record<string, unknown>;
        if (typeof c.id !== 'string' || typeof c.jobId !== 'string' || typeof c.createdAt !== 'number') return [];
        return [{ id: c.id, jobId: c.jobId, createdAt: c.createdAt }];
      })
      : [],
  };
}

function emptyLedger(userId: string): AudiobookCreditLedger {
  return {
    userId,
    available: 0,
    grantedTotal: 0,
    consumedTotal: 0,
    updatedAt: Date.now(),
    grants: [],
    consumptions: [],
  };
}

async function readLedger(userId: string): Promise<AudiobookCreditLedger> {
  const rows = await db.select({ valueJson: adminSettings.valueJson })
    .from(adminSettings)
    .where(eq(adminSettings.key, creditKey(userId)))
    .limit(1);
  return parseLedger(userId, rows[0]?.valueJson);
}

async function writeLedger(ledger: AudiobookCreditLedger): Promise<void> {
  const now = Date.now();
  const next = { ...ledger, updatedAt: now };
  await db.insert(adminSettings).values({
    key: creditKey(ledger.userId),
    valueJson: serializeForStorage(next),
    source: 'admin',
    updatedAt: now,
  }).onConflictDoUpdate({
    target: adminSettings.key,
    set: {
      valueJson: serializeForStorage(next),
      updatedAt: now,
    },
  });
}

function startOfUtcMonthMs(now = new Date()): number {
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0);
}

export async function checkMonthlyAudiobookQuota(input: {
  userId: string;
  isAdmin?: boolean;
}): Promise<{
  allowed: boolean;
  limit: number;
  used: number;
  freeLimit: number;
  paidCreditsAvailable: number;
  shouldConsumeCredit: boolean;
  resetTimeMs: number;
  supportServerUrl: string;
  supportMinimumUsd: number;
  supportExtraAudiobooks: number;
}> {
  const runtime = await getRuntimeConfig();
  const freeLimit = runtime.monthlyAudiobookLimit;
  const ledger = await readLedger(input.userId);
  const limit = freeLimit + ledger.available;
  const monthStart = startOfUtcMonthMs();
  const reset = new Date();
  reset.setUTCMonth(reset.getUTCMonth() + 1, 1);
  reset.setUTCHours(0, 0, 0, 0);

  if (input.isAdmin) {
    return {
      allowed: true,
      limit,
      used: 0,
      freeLimit,
      paidCreditsAvailable: ledger.available,
      shouldConsumeCredit: false,
      resetTimeMs: reset.getTime(),
      supportServerUrl: runtime.supportServerUrl,
      supportMinimumUsd: runtime.supportMinimumUsd,
      supportExtraAudiobooks: runtime.supportExtraAudiobooks,
    };
  }

  const rows = await db.select({ value: count() }).from(audiobookJobs).where(and(
    eq(audiobookJobs.userId, input.userId),
    gte(audiobookJobs.createdAt, monthStart),
  ));
  const used = Number(rows[0]?.value ?? 0);
  return {
    allowed: used < limit,
    limit,
    used,
    freeLimit,
    paidCreditsAvailable: ledger.available,
    shouldConsumeCredit: used >= freeLimit,
    resetTimeMs: reset.getTime(),
    supportServerUrl: runtime.supportServerUrl,
    supportMinimumUsd: runtime.supportMinimumUsd,
    supportExtraAudiobooks: runtime.supportExtraAudiobooks,
  };
}

export async function grantAudiobookCredits(input: {
  userId: string;
  credits: number;
  note?: string | null;
  id?: string;
}): Promise<AudiobookCreditLedger> {
  const credits = Math.floor(input.credits);
  if (!input.userId.trim()) throw new Error('Missing userId.');
  if (!Number.isFinite(credits) || credits < 1 || credits > 1000) throw new Error('Credits must be between 1 and 1000.');
  const ledger = await readLedger(input.userId);
  const grant = {
    id: input.id || randomUUID(),
    credits,
    note: input.note?.trim() || null,
    createdAt: Date.now(),
  };
  const next = {
    ...ledger,
    available: ledger.available + credits,
    grantedTotal: ledger.grantedTotal + credits,
    grants: [...ledger.grants, grant],
  };
  await writeLedger(next);
  return next;
}

export async function consumeAudiobookCredit(input: {
  userId: string;
  jobId: string;
}): Promise<AudiobookCreditLedger> {
  const ledger = await readLedger(input.userId);
  if (ledger.consumptions.some((entry) => entry.jobId === input.jobId)) return ledger;
  if (ledger.available < 1) throw new Error('No audiobook credits available.');
  const next = {
    ...ledger,
    available: ledger.available - 1,
    consumedTotal: ledger.consumedTotal + 1,
    consumptions: [
      ...ledger.consumptions,
      { id: randomUUID(), jobId: input.jobId, createdAt: Date.now() },
    ],
  };
  await writeLedger(next);
  return next;
}
