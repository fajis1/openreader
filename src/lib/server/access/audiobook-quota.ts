import { and, count, eq, gte, inArray, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { db } from '@/db';
import { adminSettings, audiobookJobs, userJobEvents } from '@/db/schema';
import { getRuntimeConfig } from '@/lib/server/admin/settings';

export type AudiobookCreditLedger = {
  userId: string;
  available: number;
  outstandingDebt: number;
  grantedTotal: number;
  consumedTotal: number;
  revokedTotal: number;
  updatedAt: number;
  grants: Array<{
    id: string;
    credits: number;
    debtOffset: number;
    note: string | null;
    createdByAdminId: string | null;
    createdAt: number;
  }>;
  consumptions: Array<{
    id: string;
    jobId: string;
    createdAt: number;
  }>;
  revocations: Array<{
    id: string;
    credits: number;
    removedCredits: number;
    note: string | null;
    createdAt: number;
  }>;
};

const CREDIT_PREFIX = 'audiobook_extra_credits:';
export const MONTHLY_AUDIOBOOK_USAGE_ACTION = 'audiobook_full_generation';
const ledgerMutationLocks = new Map<string, Promise<void>>();

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
  const grants = Array.isArray(rec.grants)
    ? rec.grants.flatMap((grant) => {
      if (!grant || typeof grant !== 'object') return [];
      const g = grant as Record<string, unknown>;
      const credits = Math.floor(Number(g.credits ?? 0));
      const debtOffset = Math.floor(Number(g.debtOffset ?? 0));
      if (
        typeof g.id !== 'string'
        || credits < 1
        || debtOffset < 0
        || debtOffset > credits
        || typeof g.createdAt !== 'number'
      ) return [];
      return [{
        id: g.id,
        credits,
        debtOffset,
        note: typeof g.note === 'string' && g.note.trim() ? g.note.trim() : null,
        createdByAdminId: typeof g.createdByAdminId === 'string' && g.createdByAdminId.trim()
          ? g.createdByAdminId.trim()
          : null,
        createdAt: g.createdAt,
      }];
    })
    : [];
  const revocations = Array.isArray(rec.revocations)
    ? rec.revocations.flatMap((revocation) => {
      if (!revocation || typeof revocation !== 'object') return [];
      const r = revocation as Record<string, unknown>;
      const credits = Math.floor(Number(r.credits ?? 0));
      const removedCredits = Math.floor(Number(r.removedCredits ?? 0));
      if (
        typeof r.id !== 'string'
        || credits < 1
        || removedCredits < 0
        || removedCredits > credits
        || typeof r.createdAt !== 'number'
      ) return [];
      return [{
        id: r.id,
        credits,
        removedCredits,
        note: typeof r.note === 'string' && r.note.trim() ? r.note.trim() : null,
        createdAt: r.createdAt,
      }];
    })
    : [];
  const inferredDebt = Math.max(
    0,
    revocations.reduce((total, entry) => total + entry.credits - entry.removedCredits, 0)
      - grants.reduce((total, entry) => total + entry.debtOffset, 0),
  );
  return {
    userId,
    available: Math.max(0, Math.floor(Number(rec.available ?? 0))),
    outstandingDebt: rec.outstandingDebt === undefined
      ? inferredDebt
      : Math.max(0, Math.floor(Number(rec.outstandingDebt ?? 0))),
    grantedTotal: Math.max(0, Math.floor(Number(rec.grantedTotal ?? 0))),
    consumedTotal: Math.max(0, Math.floor(Number(rec.consumedTotal ?? 0))),
    revokedTotal: Math.max(0, Math.floor(Number(rec.revokedTotal ?? 0))),
    updatedAt: Number(rec.updatedAt ?? Date.now()),
    grants,
    consumptions: Array.isArray(rec.consumptions)
      ? rec.consumptions.flatMap((consumption) => {
        if (!consumption || typeof consumption !== 'object') return [];
        const c = consumption as Record<string, unknown>;
        if (typeof c.id !== 'string' || typeof c.jobId !== 'string' || typeof c.createdAt !== 'number') return [];
        return [{ id: c.id, jobId: c.jobId, createdAt: c.createdAt }];
      })
      : [],
    revocations,
  };
}

function emptyLedger(userId: string): AudiobookCreditLedger {
  return {
    userId,
    available: 0,
    outstandingDebt: 0,
    grantedTotal: 0,
    consumedTotal: 0,
    revokedTotal: 0,
    updatedAt: Date.now(),
    grants: [],
    consumptions: [],
    revocations: [],
  };
}

async function readLedger(
  userId: string,
  database: typeof db = db,
): Promise<AudiobookCreditLedger> {
  const rows = await database.select({ valueJson: adminSettings.valueJson })
    .from(adminSettings)
    .where(eq(adminSettings.key, creditKey(userId)))
    .limit(1);
  return parseLedger(userId, rows[0]?.valueJson);
}

export async function getAudiobookCreditLedger(
  userId: string,
  database: typeof db = db,
): Promise<AudiobookCreditLedger> {
  return readLedger(userId, database);
}

export async function getAudiobookCreditLedgers(
  userIds: string[],
): Promise<Map<string, AudiobookCreditLedger>> {
  const uniqueUserIds = Array.from(new Set(userIds.filter(Boolean)));
  const ledgers = new Map<string, AudiobookCreditLedger>();
  for (const userId of uniqueUserIds) ledgers.set(userId, emptyLedger(userId));
  if (uniqueUserIds.length === 0) return ledgers;

  const rows = await db.select({
    key: adminSettings.key,
    valueJson: adminSettings.valueJson,
  }).from(adminSettings).where(inArray(
    adminSettings.key,
    uniqueUserIds.map(creditKey),
  ));
  for (const row of rows as Array<{ key: string; valueJson: unknown }>) {
    const userId = row.key.slice(CREDIT_PREFIX.length);
    if (ledgers.has(userId)) ledgers.set(userId, parseLedger(userId, row.valueJson));
  }
  return ledgers;
}

async function writeLedger(
  ledger: AudiobookCreditLedger,
  database: typeof db = db,
): Promise<void> {
  const now = Date.now();
  const next = { ...ledger, updatedAt: now };
  await database.insert(adminSettings).values({
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

async function withProcessLedgerLock<T>(userId: string, task: () => Promise<T>): Promise<T> {
  const previous = ledgerMutationLocks.get(userId) || Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => { release = resolve; });
  ledgerMutationLocks.set(userId, current);
  await previous;
  try {
    return await task();
  } finally {
    release();
    if (ledgerMutationLocks.get(userId) === current) ledgerMutationLocks.delete(userId);
  }
}

async function mutateLedger<T>(
  userId: string,
  mutation: (ledger: AudiobookCreditLedger) => Promise<{ ledger: AudiobookCreditLedger; result: T }>,
  database?: typeof db,
): Promise<T> {
  return withProcessLedgerLock(userId, async () => {
    if (database) {
      if (process.env.POSTGRES_URL) {
        await database.execute(sql`select pg_advisory_xact_lock(hashtext(${creditKey(userId)}))`);
      }
      const current = await readLedger(userId, database);
      const next = await mutation(current);
      if (next.ledger !== current) await writeLedger(next.ledger, database);
      return next.result;
    }
    if (process.env.POSTGRES_URL) {
      return db.transaction(async (tx: typeof db) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${creditKey(userId)}))`);
        const current = await readLedger(userId, tx);
        const next = await mutation(current);
        if (next.ledger !== current) await writeLedger(next.ledger, tx);
        return next.result;
      });
    }
    const current = await readLedger(userId);
    const next = await mutation(current);
    if (next.ledger !== current) await writeLedger(next.ledger);
    return next.result;
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

async function backfillMonthlyUsageEvents(userIds: string[], monthStart: number): Promise<void> {
  const uniqueUserIds = Array.from(new Set(userIds.filter(Boolean)));
  if (uniqueUserIds.length === 0) return;
  const jobs = await db.select({
    id: audiobookJobs.id,
    userId: audiobookJobs.userId,
    settingsJson: audiobookJobs.settingsJson,
    createdAt: audiobookJobs.createdAt,
  }).from(audiobookJobs).where(and(
    inArray(audiobookJobs.userId, uniqueUserIds),
    gte(audiobookJobs.createdAt, monthStart),
  ));
  const events = jobs
    .filter((job: { id: string; userId: string; settingsJson: unknown; createdAt: number | null }) => (
      isFullGenerationJob(job.settingsJson)
    ))
    .map((job: { id: string; userId: string; settingsJson: unknown; createdAt: number | null }) => ({
      userId: job.userId,
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

export async function getMonthlyAudiobookUsageCounts(
  userIds: string[],
  monthStart = startOfUtcMonthMs(),
): Promise<Map<string, number>> {
  const uniqueUserIds = Array.from(new Set(userIds.filter(Boolean)));
  const usageByUser = new Map(uniqueUserIds.map((userId) => [userId, 0]));
  if (uniqueUserIds.length === 0) return usageByUser;

  // Keep support/admin summaries consistent with the canonical quota endpoint
  // for jobs created before the durable usage ledger was introduced.
  await backfillMonthlyUsageEvents(uniqueUserIds, monthStart);
  const rows = await db.select({
    userId: userJobEvents.userId,
    used: count(),
  }).from(userJobEvents).where(and(
    inArray(userJobEvents.userId, uniqueUserIds),
    eq(userJobEvents.action, MONTHLY_AUDIOBOOK_USAGE_ACTION),
    gte(userJobEvents.createdAt, monthStart),
  )).groupBy(userJobEvents.userId);
  for (const row of rows) usageByUser.set(row.userId, Number(row.used ?? 0));
  return usageByUser;
}

async function countMonthlyUsage(userId: string, monthStart: number): Promise<number> {
  return (await getMonthlyAudiobookUsageCounts([userId], monthStart)).get(userId) ?? 0;
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

export function calculateAudiobookCreditGrantAllocation(input: {
  credits: number;
  outstandingDebt: number;
}) {
  const credits = Math.max(0, Math.floor(input.credits));
  const outstandingDebt = Math.max(0, Math.floor(input.outstandingDebt));
  const debtOffset = Math.min(credits, outstandingDebt);
  return {
    debtOffset,
    availableCredits: credits - debtOffset,
    outstandingDebt: outstandingDebt - debtOffset,
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
  createdByAdminId?: string | null;
  id?: string;
}, database?: typeof db): Promise<AudiobookCreditLedger> {
  const credits = Math.floor(input.credits);
  if (!input.userId.trim()) throw new Error('Missing userId.');
  if (!Number.isFinite(credits) || credits < 1 || credits > 1000) throw new Error('Credits must be between 1 and 1000.');
  return mutateLedger(input.userId, async (ledger) => {
    if (input.id && ledger.grants.some((grant) => grant.id === input.id)) {
      return { ledger, result: ledger };
    }
    const allocation = calculateAudiobookCreditGrantAllocation({
      credits,
      outstandingDebt: ledger.outstandingDebt,
    });
    const grant = {
      id: input.id || randomUUID(),
      credits,
      debtOffset: allocation.debtOffset,
      note: input.note?.trim() || null,
      createdByAdminId: input.createdByAdminId?.trim() || null,
      createdAt: Date.now(),
    };
    const next = {
      ...ledger,
      available: ledger.available + allocation.availableCredits,
      outstandingDebt: allocation.outstandingDebt,
      grantedTotal: ledger.grantedTotal + credits,
      revokedTotal: ledger.revokedTotal + allocation.debtOffset,
      grants: [...ledger.grants, grant],
    };
    return { ledger: next, result: next };
  }, database);
}

export async function revokeAudiobookCredits(input: {
  userId: string;
  credits: number;
  id: string;
  note?: string | null;
}, database?: typeof db): Promise<{
  ledger: AudiobookCreditLedger;
  removedCredits: number;
  shortfall: number;
}> {
  const credits = Math.floor(input.credits);
  if (!input.userId.trim()) throw new Error('Missing userId.');
  if (!input.id.trim()) throw new Error('Missing revocation id.');
  if (!Number.isFinite(credits) || credits < 1 || credits > 1000) {
    throw new Error('Credits must be between 1 and 1000.');
  }
  return mutateLedger(input.userId, async (ledger) => {
    const existing = ledger.revocations.find((entry) => entry.id === input.id);
    if (existing) {
      return {
        ledger,
        result: {
          ledger,
          removedCredits: existing.removedCredits,
          shortfall: existing.credits - existing.removedCredits,
        },
      };
    }
    const removedCredits = Math.min(ledger.available, credits);
    const revocation = {
      id: input.id,
      credits,
      removedCredits,
      note: input.note?.trim() || null,
      createdAt: Date.now(),
    };
    const next = {
      ...ledger,
      available: ledger.available - removedCredits,
      outstandingDebt: ledger.outstandingDebt + credits - removedCredits,
      revokedTotal: ledger.revokedTotal + removedCredits,
      revocations: [...ledger.revocations, revocation],
    };
    return {
      ledger: next,
      result: { ledger: next, removedCredits, shortfall: credits - removedCredits },
    };
  }, database);
}

export async function consumeAudiobookCredit(input: {
  userId: string;
  jobId: string;
}): Promise<AudiobookCreditLedger> {
  return mutateLedger(input.userId, async (ledger) => {
    if (ledger.consumptions.some((entry) => entry.jobId === input.jobId)) {
      return { ledger, result: ledger };
    }
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
    return { ledger: next, result: next };
  });
}
