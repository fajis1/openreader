import { and, count, eq, gte } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { db } from '@/db';
import { adminSettings, audiobookJobs, userJobEvents } from '@/db/schema';
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
export const MONTHLY_AUDIOBOOK_USAGE_ACTION = 'audiobook_full_generation';

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

function isFullGenerationJob(settingsJson: unknown): boolean {
  let value = settingsJson;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return true;
    }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return true;
  const settings = value as Record<string, unknown>;
  return settings.batchRegenerate !== true && settings.monthlyQuotaCharge !== false;
}

async function backfillMonthlyUsageEvents(userId: string, monthStart: number): Promise<void> {
  const jobs = await db.select({
    id: audiobookJobs.id,
    settingsJson: audiobookJobs.settingsJson,
    createdAt: audiobookJobs.createdAt,
  }).from(audiobookJobs).where(and(
    eq(audiobookJobs.userId, userId),
    gte(audiobookJobs.createdAt, monthStart),
  ));
  const events = jobs
    .filter((job: { id: string; settingsJson: unknown; createdAt: number | null }) => (
      isFullGenerationJob(job.settingsJson)
    ))
    .map((job: { id: string; settingsJson: unknown; createdAt: number | null }) => ({
      userId,
      action: MONTHLY_AUDIOBOOK_USAGE_ACTION,
      opId: job.id,
      createdAt: Number(job.createdAt ?? Date.now()),
    }));
  if (events.length === 0) return;
  await db.insert(userJobEvents)
    .values(events)
    .onConflictDoNothing({
      target: [userJobEvents.userId, userJobEvents.action, userJobEvents.opId],
    });
}

async function countMonthlyUsage(userId: string, monthStart: number): Promise<number> {
  // Backfill jobs created before the durable usage ledger was introduced.
  // The ledger is not deleted when an audiobook or queue row is reset.
  await backfillMonthlyUsageEvents(userId, monthStart);
  const rows = await db.select({ value: count() }).from(userJobEvents).where(and(
    eq(userJobEvents.userId, userId),
    eq(userJobEvents.action, MONTHLY_AUDIOBOOK_USAGE_ACTION),
    gte(userJobEvents.createdAt, monthStart),
  ));
  return Number(rows[0]?.value ?? 0);
}

export function calculateMonthlyAudiobookAllowance(input: {
  used: number;
  freeLimit: number;
  paidCreditsAvailable: number;
}) {
  const used = Math.max(0, Math.floor(input.used));
  const freeLimit = Math.max(0, Math.floor(input.freeLimit));
  const paidCreditsAvailable = Math.max(0, Math.floor(input.paidCreditsAvailable));
  const freeUsed = Math.min(used, freeLimit);
  const freeRemaining = Math.max(0, freeLimit - used);
  const totalRemaining = freeRemaining + paidCreditsAvailable;
  return {
    used,
    freeLimit,
    freeUsed,
    freeRemaining,
    paidCreditsAvailable,
    supportCreditsRemaining: paidCreditsAvailable,
    totalRemaining,
    limit: used + totalRemaining,
    allowed: totalRemaining > 0,
    shouldConsumeCredit: freeRemaining === 0 && paidCreditsAvailable > 0,
  };
}

export async function recordMonthlyAudiobookUsage(input: {
  userId: string;
  jobId: string;
  createdAt?: number;
}): Promise<void> {
  await db.insert(userJobEvents).values({
    userId: input.userId,
    action: MONTHLY_AUDIOBOOK_USAGE_ACTION,
    opId: input.jobId,
    createdAt: input.createdAt ?? Date.now(),
  }).onConflictDoNothing({
    target: [userJobEvents.userId, userJobEvents.action, userJobEvents.opId],
  });
}

export async function checkMonthlyAudiobookQuota(input: {
  userId: string;
  isAdmin?: boolean;
}): Promise<{
  allowed: boolean;
  unlimited: boolean;
  limit: number;
  used: number;
  freeLimit: number;
  freeUsed: number;
  freeRemaining: number;
  paidCreditsAvailable: number;
  supportCreditsRemaining: number;
  totalRemaining: number;
  shouldConsumeCredit: boolean;
  resetTimeMs: number;
  supportServerUrl: string;
  supportMinimumUsd: number;
  supportExtraAudiobooks: number;
}> {
  const runtime = await getRuntimeConfig();
  const freeLimit = runtime.monthlyAudiobookLimit;
  const ledger = await readLedger(input.userId);
  const monthStart = startOfUtcMonthMs();
  const reset = new Date();
  reset.setUTCMonth(reset.getUTCMonth() + 1, 1);
  reset.setUTCHours(0, 0, 0, 0);

  if (input.isAdmin) {
    return {
      allowed: true,
      unlimited: true,
      limit: freeLimit + ledger.available,
      used: 0,
      freeLimit,
      freeUsed: 0,
      freeRemaining: freeLimit,
      paidCreditsAvailable: ledger.available,
      supportCreditsRemaining: ledger.available,
      totalRemaining: freeLimit + ledger.available,
      shouldConsumeCredit: false,
      resetTimeMs: reset.getTime(),
      supportServerUrl: runtime.supportServerUrl,
      supportMinimumUsd: runtime.supportMinimumUsd,
      supportExtraAudiobooks: runtime.supportExtraAudiobooks,
    };
  }

  const allowance = calculateMonthlyAudiobookAllowance({
    used: await countMonthlyUsage(input.userId, monthStart),
    freeLimit,
    paidCreditsAvailable: ledger.available,
  });
  return {
    ...allowance,
    unlimited: false,
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
