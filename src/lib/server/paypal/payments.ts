import { randomUUID } from 'node:crypto';
import { and, asc, count, eq, gte, isNull, or, sql } from 'drizzle-orm';
import { db } from '@/db';
import { paypalWebhookEvents, supportPayments } from '@/db/schema';
import * as authSchemaSqlite from '@/db/schema_auth_sqlite';
import * as authSchemaPostgres from '@/db/schema_auth_postgres';
import {
  grantAudiobookCredits,
  revokeAudiobookCredits,
} from '@/lib/server/access/audiobook-quota';
import { recordSupportAudit } from '@/lib/server/admin/support';
import { getRuntimeConfig } from '@/lib/server/admin/settings';
import { errorToLog, hashForLog, serverLogger } from '@/lib/server/logger';
import {
  capturePayPalOrderRequest,
  createPayPalOrderRequest,
  getPayPalOrderRequest,
  PayPalApiError,
  type PayPalOrderResponse,
  verifyPayPalWebhookRequest,
} from './client';
import { getPayPalConfig } from './config';

const authUser = process.env.POSTGRES_URL ? authSchemaPostgres.user : authSchemaSqlite.user;
const PAYPAL_SYSTEM_ACTOR_ID = 'system:paypal';
const MAX_PAYPAL_ID_LENGTH = 200;
const WEBHOOK_PROCESSING_LEASE_MS = 5 * 60_000;
const paymentMutationLocks = new Map<string, Promise<void>>();
const checkoutCreationLocks = new Map<string, Promise<void>>();

type UnknownRecord = Record<string, unknown>;

type PaymentRow = {
  id: string;
  userId: string;
  environment: string;
  paypalOrderId: string | null;
  paypalCaptureId: string | null;
  status: string;
  amountCents: number;
  currency: string;
  credits: number;
  creditsGranted: number;
  creditsRevoked: number;
  reversalShortfall: number;
  failureCode: string | null;
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
  reversedAt: number | null;
};

type VerifiedCapture = {
  captureId: string;
  orderId: string | null;
  customId: string | null;
  status: string;
  amountCents: number | null;
  currency: string | null;
  merchantId: string | null;
};

type NormalizedReversal = {
  eventId: string;
  eventType: 'PAYMENT.CAPTURE.REFUNDED' | 'PAYMENT.CAPTURE.REVERSED';
  resourceId: string;
  captureId: string;
  orderId: string | null;
  customId: string | null;
  amountCents: number | null;
  currency: string | null;
};

type CaptureResult = {
  status: 'completed' | 'pending' | 'failed' | 'reversed';
  creditsGranted: number;
};

export function classifyPayPalCaptureStatus(
  value: unknown,
): 'completed' | 'pending' | 'failed' | 'review' {
  const status = typeof value === 'string' ? value.trim().toUpperCase() : '';
  if (status === 'COMPLETED') return 'completed';
  if (status === 'PENDING') return 'pending';
  if (['DECLINED', 'DENIED', 'FAILED', 'VOIDED', 'EXPIRED'].includes(status)) return 'failed';
  return 'review';
}

export function classifyPayPalWebhookReplay(
  existing: { status: string; createdAt: number; processedAt: number | null } | null,
  receivedAt: number,
): 'busy' | 'duplicate' | 'reclaim' | 'missing' {
  if (!existing) return 'missing';
  if (existing.status === 'failed') return 'reclaim';
  if (existing.status === 'received' || existing.status === 'retrying') {
    const leaseStartedAt = Number(existing.processedAt ?? existing.createdAt);
    return leaseStartedAt < receivedAt - WEBHOOK_PROCESSING_LEASE_MS ? 'reclaim' : 'busy';
  }
  return 'duplicate';
}

export class PayPalCheckoutError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = 'PayPalCheckoutError';
    this.code = code;
    this.status = status;
  }
}

function asRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as UnknownRecord
    : null;
}

function boundedString(value: unknown, maxLength = MAX_PAYPAL_ID_LENGTH): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized && normalized.length <= maxLength ? normalized : null;
}

export function paypalAmountToCents(value: unknown): number | null {
  if (typeof value !== 'string' || !/^\d+(?:\.\d{1,2})?$/.test(value)) return null;
  const [whole, fraction = ''] = value.split('.');
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return Number.isSafeInteger(cents) && cents >= 0 ? cents : null;
}

function centsToPayPalAmount(cents: number): string {
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
}

export function isSafePayPalApprovalUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:'
      && (url.hostname === 'paypal.com' || url.hostname.endsWith('.paypal.com'));
  } catch {
    return false;
  }
}

function toPaymentRow(value: unknown): PaymentRow | null {
  const row = asRecord(value);
  if (!row || typeof row.id !== 'string' || typeof row.userId !== 'string') return null;
  return row as unknown as PaymentRow;
}

function findApprovalUrl(order: PayPalOrderResponse): string | null {
  const link = Array.isArray(order.links)
    ? order.links.find((candidate) => candidate?.rel === 'payer-action' || candidate?.rel === 'approve')
    : null;
  return isSafePayPalApprovalUrl(link?.href) ? link.href : null;
}

function extractCaptureFromOrder(order: PayPalOrderResponse): VerifiedCapture | null {
  const purchaseUnits = Array.isArray(order.purchase_units) ? order.purchase_units : [];
  for (const purchaseUnitValue of purchaseUnits) {
    const purchaseUnit = asRecord(purchaseUnitValue);
    if (!purchaseUnit) continue;
    const payments = asRecord(purchaseUnit.payments);
    const captures = Array.isArray(payments?.captures) ? payments.captures : [];
    const capture = captures.map(asRecord).find((item) => item?.status === 'COMPLETED')
      || captures.map(asRecord).find(Boolean);
    if (!capture) continue;
    const amount = asRecord(capture.amount);
    const payee = asRecord(purchaseUnit.payee) || asRecord(capture.payee);
    const relatedIds = asRecord(asRecord(capture.supplementary_data)?.related_ids);
    const captureId = boundedString(capture.id);
    if (!captureId) continue;
    return {
      captureId,
      orderId: boundedString(relatedIds?.order_id) || boundedString(order.id),
      customId: boundedString(capture.custom_id) || boundedString(purchaseUnit.custom_id),
      status: boundedString(capture.status, 40) || '',
      amountCents: paypalAmountToCents(amount?.value),
      currency: boundedString(amount?.currency_code, 10),
      merchantId: boundedString(payee?.merchant_id),
    };
  }
  return null;
}

function extractCaptureFromWebhookResource(resource: UnknownRecord): VerifiedCapture | null {
  const amount = asRecord(resource.amount);
  const payee = asRecord(resource.payee);
  const relatedIds = asRecord(asRecord(resource.supplementary_data)?.related_ids);
  const captureId = boundedString(resource.id);
  if (!captureId) return null;
  return {
    captureId,
    orderId: boundedString(relatedIds?.order_id),
    customId: boundedString(resource.custom_id),
    status: boundedString(resource.status, 40) || '',
    amountCents: paypalAmountToCents(amount?.value),
    currency: boundedString(amount?.currency_code, 10),
    merchantId: boundedString(payee?.merchant_id),
  };
}

export function extractPayPalRefundCaptureId(value: unknown): string | null {
  const resource = asRecord(value);
  if (!resource) return null;
  const relatedIds = asRecord(asRecord(resource.supplementary_data)?.related_ids);
  const relatedCaptureId = boundedString(relatedIds?.capture_id);
  if (relatedCaptureId) return relatedCaptureId;

  const links = Array.isArray(resource.links) ? resource.links : [];
  for (const linkValue of links) {
    const link = asRecord(linkValue);
    if (boundedString(link?.rel, 40)?.toLowerCase() !== 'up') continue;
    const href = boundedString(link?.href, 2_000);
    if (!href) continue;
    try {
      const pathname = new URL(href).pathname;
      const match = pathname.match(/^\/v2\/payments\/captures\/([^/]+)\/?$/i);
      if (!match) continue;
      const captureId = boundedString(decodeURIComponent(match[1]));
      if (captureId) return captureId;
    } catch {
      // Ignore malformed HATEOAS links and continue looking for a valid parent.
    }
  }
  return null;
}

function normalizeReversal(
  eventId: string,
  eventType: string,
  resource: UnknownRecord,
): NormalizedReversal | null {
  if (eventType !== 'PAYMENT.CAPTURE.REFUNDED' && eventType !== 'PAYMENT.CAPTURE.REVERSED') {
    return null;
  }
  const relatedIds = asRecord(asRecord(resource.supplementary_data)?.related_ids);
  const resourceId = boundedString(resource.id);
  const captureId = eventType === 'PAYMENT.CAPTURE.REVERSED'
    ? resourceId
    : extractPayPalRefundCaptureId(resource);
  if (!resourceId || !captureId) return null;
  const amount = asRecord(resource.amount);
  return {
    eventId,
    eventType,
    resourceId,
    captureId,
    orderId: boundedString(relatedIds?.order_id) || boundedString(resource.order_id),
    customId: boundedString(resource.custom_id),
    amountCents: paypalAmountToCents(amount?.value),
    currency: boundedString(amount?.currency_code, 10),
  };
}

function safeFailureCode(error: unknown): string {
  if (error instanceof PayPalCheckoutError || error instanceof PayPalApiError) return error.code.slice(0, 100);
  return 'internal_error';
}

async function updatePaymentFailure(paymentId: string, error: unknown): Promise<void> {
  await db.update(supportPayments).set({
    status: 'failed',
    failureCode: safeFailureCode(error),
    updatedAt: Date.now(),
  }).where(eq(supportPayments.id, paymentId));
}

async function findPaymentById(
  paymentId: string,
  database: typeof db = db,
): Promise<PaymentRow | null> {
  const rows = await database.select().from(supportPayments)
    .where(eq(supportPayments.id, paymentId)).limit(1);
  return toPaymentRow(rows[0]);
}

async function withProcessMutex<T>(
  locks: Map<string, Promise<void>>,
  key: string,
  task: () => Promise<T>,
): Promise<T> {
  const previous = locks.get(key) || Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => { release = resolve; });
  locks.set(key, current);
  await previous;
  try {
    return await task();
  } finally {
    release();
    if (locks.get(key) === current) locks.delete(key);
  }
}

async function withPaymentMutationLock<T>(
  paymentId: string,
  task: (database: typeof db) => Promise<T>,
): Promise<T> {
  return withProcessMutex(paymentMutationLocks, paymentId, async () => {
    if (process.env.POSTGRES_URL) {
      return db.transaction(async (tx: typeof db) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`paypal-payment:${paymentId}`}))`);
        return task(tx);
      });
    }
    return task(db);
  });
}

async function findPaymentForCapture(capture: VerifiedCapture): Promise<PaymentRow | null> {
  if (capture.customId) {
    const byCustomId = await findPaymentById(capture.customId);
    if (byCustomId) return byCustomId;
  }
  if (capture.orderId) {
    const rows = await db.select().from(supportPayments)
      .where(eq(supportPayments.paypalOrderId, capture.orderId)).limit(1);
    const payment = toPaymentRow(rows[0]);
    if (payment) return payment;
  }
  const rows = await db.select().from(supportPayments)
    .where(eq(supportPayments.paypalCaptureId, capture.captureId)).limit(1);
  return toPaymentRow(rows[0]);
}

async function findPaymentForReversal(reversal: NormalizedReversal): Promise<PaymentRow | null> {
  const captureRows = await db.select().from(supportPayments)
    .where(eq(supportPayments.paypalCaptureId, reversal.captureId)).limit(1);
  const byCapture = toPaymentRow(captureRows[0]);
  if (byCapture) return byCapture;
  if (reversal.customId) {
    const byCustomId = await findPaymentById(reversal.customId);
    if (byCustomId) return byCustomId;
  }
  if (reversal.orderId) {
    const orderRows = await db.select().from(supportPayments)
      .where(eq(supportPayments.paypalOrderId, reversal.orderId)).limit(1);
    const byOrder = toPaymentRow(orderRows[0]);
    if (byOrder) return byOrder;
  }
  return null;
}

async function userStillExists(userId: string, database: typeof db = db): Promise<boolean> {
  const rows = await database.select({ id: authUser.id }).from(authUser)
    .where(eq(authUser.id, userId)).limit(1);
  return rows.length > 0;
}

async function markPaymentForReview(
  payment: PaymentRow,
  code: string,
  database: typeof db = db,
): Promise<void> {
  await database.update(supportPayments).set({
    status: 'review_required',
    failureCode: code.slice(0, 100),
    updatedAt: Date.now(),
  }).where(eq(supportPayments.id, payment.id));
}

function validateCapture(payment: PaymentRow, capture: VerifiedCapture): void {
  if (capture.amountCents !== payment.amountCents || capture.currency !== payment.currency) {
    throw new PayPalCheckoutError('amount_mismatch', 'The PayPal payment needs administrator review.', 409);
  }
  if (capture.customId && capture.customId !== payment.id) {
    throw new PayPalCheckoutError('payment_reference_mismatch', 'The PayPal payment needs administrator review.', 409);
  }
  if (capture.orderId && payment.paypalOrderId && capture.orderId !== payment.paypalOrderId) {
    throw new PayPalCheckoutError('order_mismatch', 'The PayPal payment needs administrator review.', 409);
  }
  const merchantId = getPayPalConfig().merchantId;
  if (merchantId && capture.merchantId !== merchantId) {
    throw new PayPalCheckoutError('merchant_mismatch', 'The PayPal payment needs administrator review.', 409);
  }
}

async function completeVerifiedCapture(
  payment: PaymentRow,
  capture: VerifiedCapture,
): Promise<CaptureResult> {
  return withPaymentMutationLock(payment.id, async (database) => {
    const refreshed = await findPaymentById(payment.id, database);
    if (!refreshed) {
      throw new PayPalCheckoutError('payment_not_found', 'This PayPal payment was not found.', 404);
    }
    return completeVerifiedCaptureLocked(refreshed, capture, database);
  });
}

async function completeVerifiedCaptureLocked(
  payment: PaymentRow,
  capture: VerifiedCapture,
  database: typeof db,
): Promise<CaptureResult> {
  if (payment.status === 'completed' && payment.paypalCaptureId === capture.captureId) {
    const reconciled = await reconcileDeferredReversals(payment, capture, database);
    return reconciled.status === 'completed'
      ? { status: 'completed', creditsGranted: reconciled.creditsGranted }
      : { status: 'reversed', creditsGranted: 0 };
  }
  if (payment.status === 'refunded' || payment.status === 'reversed') {
    return { status: 'reversed', creditsGranted: 0 };
  }
  if (payment.status === 'review_required') {
    return { status: 'reversed', creditsGranted: 0 };
  }
  const captureDisposition = classifyPayPalCaptureStatus(capture.status);
  if (captureDisposition === 'pending') {
    await database.update(supportPayments).set({
      status: 'capture_pending',
      failureCode: null,
      updatedAt: Date.now(),
    }).where(eq(supportPayments.id, payment.id));
    return { status: 'pending', creditsGranted: 0 };
  }
  if (captureDisposition === 'failed') {
    const captureStatus = capture.status.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 60)
      || 'unknown';
    await database.update(supportPayments).set({
      status: 'failed',
      failureCode: `capture_${captureStatus}`,
      updatedAt: Date.now(),
    }).where(eq(supportPayments.id, payment.id));
    return { status: 'failed', creditsGranted: 0 };
  }
  if (captureDisposition === 'review') {
    await markPaymentForReview(payment, 'unexpected_capture_status', database);
    return { status: 'failed', creditsGranted: 0 };
  }

  try {
    validateCapture(payment, capture);
  } catch (error) {
    await markPaymentForReview(payment, safeFailureCode(error), database);
    throw error;
  }

  const duplicateRows = await database.select({ id: supportPayments.id }).from(supportPayments)
    .where(eq(supportPayments.paypalCaptureId, capture.captureId)).limit(1);
  if (duplicateRows[0] && duplicateRows[0].id !== payment.id) {
    await markPaymentForReview(payment, 'duplicate_capture', database);
    throw new PayPalCheckoutError('duplicate_capture', 'The PayPal payment needs administrator review.', 409);
  }
  if (!await userStillExists(payment.userId, database)) {
    await markPaymentForReview(payment, 'user_not_found', database);
    throw new PayPalCheckoutError('user_not_found', 'The account for this payment no longer exists.', 409);
  }

  const grantId = `paypal-capture:${capture.captureId}`;
  const ledger = await grantAudiobookCredits({
    userId: payment.userId,
    credits: payment.credits,
    note: 'Verified PayPal support payment',
    createdByAdminId: null,
    id: grantId,
  }, database);
  const grant = ledger.grants.find((entry) => entry.id === grantId);
  const grantAuditNote = grant?.debtOffset
    ? `Verified PayPal support payment; ${grant.debtOffset} credit${grant.debtOffset === 1 ? '' : 's'} applied to reversal debt`
    : 'Verified PayPal support payment';
  // Both writes are conflict-safe. Always retry the audit so a transient audit
  // failure can never leave an otherwise-idempotent credit grant undocumented.
  await recordSupportAudit({
    id: grantId,
    adminUserId: PAYPAL_SYSTEM_ACTOR_ID,
    targetUserId: payment.userId,
    action: 'paypal_credit_grant',
    resourceId: capture.captureId,
    amount: payment.credits,
    note: grantAuditNote,
  }, database);

  const now = Date.now();
  await database.update(supportPayments).set({
    paypalCaptureId: capture.captureId,
    status: 'completed',
    creditsGranted: payment.credits,
    failureCode: null,
    completedAt: payment.completedAt || now,
    updatedAt: now,
  }).where(eq(supportPayments.id, payment.id));
  const completedPayment = await findPaymentById(payment.id, database);
  if (!completedPayment) {
    throw new PayPalCheckoutError('payment_not_found', 'This PayPal payment was not found.', 404);
  }
  const reconciled = await reconcileDeferredReversals(completedPayment, capture, database);
  return reconciled.status === 'completed'
    ? { status: 'completed', creditsGranted: reconciled.creditsGranted }
    : { status: 'reversed', creditsGranted: 0 };
}

async function reserveSupportPayment(input: {
  paymentId: string;
  userId: string;
  environment: string;
  amountCents: number;
  credits: number;
  now: number;
}): Promise<void> {
  await withProcessMutex(checkoutCreationLocks, input.userId, async () => {
    const reserve = async (database: typeof db) => {
      const recentRows = await database.select({ value: count() }).from(supportPayments).where(and(
        eq(supportPayments.userId, input.userId),
        gte(supportPayments.createdAt, input.now - 60 * 60_000),
      ));
      if (Number(recentRows[0]?.value || 0) >= 10) {
        throw new PayPalCheckoutError('checkout_rate_limited', 'Too many PayPal checkouts were started. Try again later.', 429);
      }
      await database.insert(supportPayments).values({
        id: input.paymentId,
        userId: input.userId,
        environment: input.environment,
        status: 'creating',
        amountCents: input.amountCents,
        currency: 'USD',
        credits: input.credits,
        createdAt: input.now,
        updatedAt: input.now,
      });
    };
    if (process.env.POSTGRES_URL) {
      await db.transaction(async (tx: typeof db) => {
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`paypal-checkout:${input.userId}`}))`);
        await reserve(tx);
      });
      return;
    }
    await reserve(db);
  });
}

export async function createSupportPayment(input: {
  userId: string;
  expectedAmountUsd: number;
  expectedCredits: number;
}): Promise<{
  paymentId: string;
  orderId: string;
  approvalUrl: string;
}> {
  const config = getPayPalConfig();
  const runtime = await getRuntimeConfig();
  const amountCents = Math.floor(runtime.supportMinimumUsd) * 100;
  const credits = Math.floor(runtime.supportExtraAudiobooks);
  if (amountCents < 100 || amountCents > 100_000 || credits < 1 || credits > 1000) {
    throw new PayPalCheckoutError('invalid_support_package', 'The support package is not configured correctly.', 503);
  }
  if (
    !Number.isInteger(input.expectedAmountUsd)
    || !Number.isInteger(input.expectedCredits)
    || input.expectedAmountUsd !== runtime.supportMinimumUsd
    || input.expectedCredits !== runtime.supportExtraAudiobooks
  ) {
    throw new PayPalCheckoutError(
      'support_package_changed',
      'The support package changed. Refresh the Reader and review the current terms.',
      409,
    );
  }
  const paymentId = randomUUID();
  const now = Date.now();
  await reserveSupportPayment({
    paymentId,
    userId: input.userId,
    environment: config.environment,
    amountCents,
    credits,
    now,
  });

  try {
    const order = await createPayPalOrderRequest({
      config,
      paymentId,
      amount: centsToPayPalAmount(amountCents),
      currency: 'USD',
      credits,
    });
    const orderId = boundedString(order.id);
    const approvalUrl = findApprovalUrl(order);
    if (!orderId || !approvalUrl) {
      throw new PayPalCheckoutError('invalid_create_response', 'PayPal did not return a usable checkout.', 502);
    }
    await db.update(supportPayments).set({
      paypalOrderId: orderId,
      status: 'awaiting_approval',
      failureCode: null,
      updatedAt: Date.now(),
    }).where(eq(supportPayments.id, paymentId));
    return { paymentId, orderId, approvalUrl };
  } catch (error) {
    await updatePaymentFailure(paymentId, error);
    serverLogger.error({
      event: 'paypal.order.create.failed',
      paymentIdHash: hashForLog(paymentId),
      userIdHash: hashForLog(input.userId),
      error: errorToLog(error),
    }, 'Failed to create PayPal support order');
    throw error;
  }
}

export async function captureSupportPayment(input: {
  userId: string;
  orderId: string;
}): Promise<CaptureResult> {
  const orderId = boundedString(input.orderId);
  if (!orderId) throw new PayPalCheckoutError('missing_order', 'The PayPal order is missing.');
  const rows = await db.select().from(supportPayments).where(and(
    eq(supportPayments.userId, input.userId),
    eq(supportPayments.paypalOrderId, orderId),
  )).limit(1);
  const payment = toPaymentRow(rows[0]);
  if (!payment) throw new PayPalCheckoutError('payment_not_found', 'This PayPal payment was not found.', 404);
  const config = getPayPalConfig();
  if (payment.environment !== config.environment) {
    await markPaymentForReview(payment, 'environment_mismatch');
    throw new PayPalCheckoutError('environment_mismatch', 'The PayPal environment changed during checkout.', 409);
  }
  if (payment.status === 'completed' && payment.paypalCaptureId) {
    return { status: 'completed', creditsGranted: payment.creditsGranted };
  }
  if (
    payment.status === 'refunded'
    || payment.status === 'reversed'
    || payment.status === 'review_required'
  ) {
    return { status: 'reversed', creditsGranted: 0 };
  }

  let order: PayPalOrderResponse;
  try {
    order = await capturePayPalOrderRequest({
      config,
      paymentId: payment.id,
      orderId,
    });
  } catch (error) {
    if (!(error instanceof PayPalApiError) || error.code !== 'ORDER_ALREADY_CAPTURED') throw error;
    order = await getPayPalOrderRequest({ config, orderId });
  }
  const capture = extractCaptureFromOrder(order);
  if (!capture) {
    await db.update(supportPayments).set({ status: 'capture_pending', updatedAt: Date.now() })
      .where(eq(supportPayments.id, payment.id));
    return { status: 'pending', creditsGranted: 0 };
  }
  return completeVerifiedCapture(payment, capture);
}

async function reversePaymentFromWebhook(
  reversal: NormalizedReversal,
): Promise<{ paymentId: string | null; status: 'processed' | 'deferred' }> {
  const payment = await findPaymentForReversal(reversal);
  if (!payment) return { paymentId: null, status: 'deferred' };
  return withPaymentMutationLock(payment.id, async (database) => {
    const refreshed = await findPaymentById(payment.id, database);
    if (!refreshed) return { paymentId: null, status: 'deferred' as const };
    return reversePaymentLocked(reversal, refreshed, database);
  });
}

async function reversePaymentLocked(
  reversal: NormalizedReversal,
  payment: PaymentRow,
  database: typeof db,
): Promise<{ paymentId: string; status: 'processed' }> {
  if (payment.status === 'refunded' || payment.status === 'reversed') {
    return { paymentId: payment.id, status: 'processed' };
  }

  if (
    (payment.paypalCaptureId && payment.paypalCaptureId !== reversal.captureId)
    || (reversal.customId && reversal.customId !== payment.id)
    || (reversal.orderId && payment.paypalOrderId && reversal.orderId !== payment.paypalOrderId)
  ) {
    await markPaymentForReview(payment, 'reversal_reference_mismatch', database);
    return { paymentId: payment.id, status: 'processed' };
  }
  const duplicateRows = await database.select({ id: supportPayments.id }).from(supportPayments)
    .where(eq(supportPayments.paypalCaptureId, reversal.captureId)).limit(1);
  if (duplicateRows[0] && duplicateRows[0].id !== payment.id) {
    await markPaymentForReview(payment, 'duplicate_capture', database);
    return { paymentId: payment.id, status: 'processed' };
  }
  if (reversal.amountCents !== payment.amountCents || reversal.currency !== payment.currency) {
    await markPaymentForReview(payment, 'partial_refund_review', database);
    await recordSupportAudit({
      id: `paypal-partial-refund:${reversal.eventId}`,
      adminUserId: PAYPAL_SYSTEM_ACTOR_ID,
      targetUserId: payment.userId,
      action: 'paypal_partial_refund_review',
      resourceId: reversal.captureId,
      note: 'A partial or mismatched PayPal reversal requires administrator review',
    }, database);
    return { paymentId: payment.id, status: 'processed' };
  }

  let removedCredits = 0;
  let shortfall = 0;
  if (payment.creditsGranted > 0) {
    const revocation = await revokeAudiobookCredits({
      userId: payment.userId,
      credits: payment.creditsGranted,
      id: `paypal-reversal:${payment.id}`,
      note: 'PayPal payment refunded or reversed',
    }, database);
    removedCredits = revocation.removedCredits;
    shortfall = revocation.shortfall;
  }
  const reversedStatus = reversal.eventType === 'PAYMENT.CAPTURE.REFUNDED' ? 'refunded' : 'reversed';
  const now = Date.now();
  await database.update(supportPayments).set({
    paypalCaptureId: payment.paypalCaptureId || reversal.captureId,
    status: reversedStatus,
    creditsRevoked: removedCredits,
    reversalShortfall: shortfall,
    failureCode: shortfall > 0 ? 'reversal_credit_shortfall' : null,
    reversedAt: now,
    updatedAt: now,
  }).where(eq(supportPayments.id, payment.id));
  await recordSupportAudit({
    id: `paypal-reversal:${payment.id}`,
    adminUserId: PAYPAL_SYSTEM_ACTOR_ID,
    targetUserId: payment.userId,
    action: `paypal_credit_${reversedStatus}`,
    resourceId: reversal.captureId,
    amount: -removedCredits,
    note: shortfall > 0
      ? `${removedCredits} unused credits removed; ${shortfall} already-used credits recorded as reversal debt`
      : 'Unused credits removed after PayPal reversal',
  }, database);
  return { paymentId: payment.id, status: 'processed' };
}

async function reconcileDeferredReversals(
  payment: PaymentRow,
  capture: VerifiedCapture,
  database: typeof db,
): Promise<PaymentRow> {
  const references = [eq(paypalWebhookEvents.captureId, capture.captureId)];
  if (capture.orderId) references.push(eq(paypalWebhookEvents.orderId, capture.orderId));
  if (capture.customId) references.push(eq(paypalWebhookEvents.customId, capture.customId));
  const rows = await database.select({
    eventId: paypalWebhookEvents.id,
    eventType: paypalWebhookEvents.eventType,
    resourceId: paypalWebhookEvents.resourceId,
    captureId: paypalWebhookEvents.captureId,
    orderId: paypalWebhookEvents.orderId,
    customId: paypalWebhookEvents.customId,
    amountCents: paypalWebhookEvents.amountCents,
    currency: paypalWebhookEvents.currency,
  }).from(paypalWebhookEvents).where(and(
    eq(paypalWebhookEvents.status, 'deferred'),
    or(...references),
  )).orderBy(asc(paypalWebhookEvents.createdAt));

  let current = payment;
  for (const row of rows as Array<{
    eventId: string;
    eventType: string;
    resourceId: string | null;
    captureId: string | null;
    orderId: string | null;
    customId: string | null;
    amountCents: number | null;
    currency: string | null;
  }>) {
    if (
      (row.eventType !== 'PAYMENT.CAPTURE.REFUNDED' && row.eventType !== 'PAYMENT.CAPTURE.REVERSED')
      || !row.resourceId
      || !row.captureId
    ) continue;
    const result = await reversePaymentLocked({
      eventId: row.eventId,
      eventType: row.eventType,
      resourceId: row.resourceId,
      captureId: row.captureId,
      orderId: row.orderId,
      customId: row.customId,
      amountCents: row.amountCents,
      currency: row.currency,
    }, current, database);
    await database.update(paypalWebhookEvents).set({
      paymentId: result.paymentId,
      status: result.status,
      processedAt: Date.now(),
    }).where(and(
      eq(paypalWebhookEvents.id, row.eventId),
      eq(paypalWebhookEvents.status, 'deferred'),
    ));
    current = await findPaymentById(payment.id, database) || current;
  }
  return current;
}

export async function processPayPalWebhook(input: {
  headers: Headers;
  event: unknown;
}): Promise<{ status: 'processed' | 'ignored' | 'duplicate' | 'deferred'; paymentId: string | null }> {
  const event = asRecord(input.event);
  const eventId = boundedString(event?.id);
  const eventType = boundedString(event?.event_type, 100);
  const resource = asRecord(event?.resource);
  if (!event || !eventId || !eventType || !resource) {
    throw new PayPalCheckoutError('invalid_webhook', 'Invalid PayPal webhook.', 400);
  }
  const config = getPayPalConfig();
  if (!await verifyPayPalWebhookRequest({
    config,
    headers: input.headers,
    webhookEvent: event,
  })) {
    throw new PayPalCheckoutError('invalid_webhook_signature', 'Invalid PayPal webhook signature.', 400);
  }

  const captureEvent = eventType === 'PAYMENT.CAPTURE.COMPLETED'
    || eventType === 'PAYMENT.CAPTURE.DENIED';
  const completedCapture = captureEvent
    ? extractCaptureFromWebhookResource(resource)
    : null;
  const reversal = normalizeReversal(eventId, eventType, resource);

  const receivedAt = Date.now();
  const inserted = await db.insert(paypalWebhookEvents).values({
    id: eventId,
    eventType,
    resourceId: reversal?.resourceId || completedCapture?.captureId || boundedString(resource.id),
    captureId: reversal?.captureId || completedCapture?.captureId || null,
    orderId: reversal?.orderId || completedCapture?.orderId || null,
    customId: reversal?.customId || completedCapture?.customId || null,
    amountCents: reversal?.amountCents ?? completedCapture?.amountCents ?? null,
    currency: reversal?.currency || completedCapture?.currency || null,
    status: 'received',
    createdAt: receivedAt,
  }).onConflictDoNothing({ target: paypalWebhookEvents.id }).returning({ id: paypalWebhookEvents.id });
  if (inserted.length === 0) {
    const existingRows = await db.select({
      status: paypalWebhookEvents.status,
      createdAt: paypalWebhookEvents.createdAt,
      processedAt: paypalWebhookEvents.processedAt,
    }).from(paypalWebhookEvents).where(eq(paypalWebhookEvents.id, eventId)).limit(1);
    const existing = existingRows[0] as {
      status: string;
      createdAt: number;
      processedAt: number | null;
    } | undefined;
    const replay = classifyPayPalWebhookReplay(existing || null, receivedAt);
    if (replay === 'busy') {
      throw new PayPalCheckoutError(
        'webhook_processing',
        'This PayPal webhook is still being processed.',
        503,
      );
    }
    if (replay === 'duplicate') {
      return { status: 'duplicate', paymentId: null };
    }
    if (replay === 'missing' || !existing) {
      throw new PayPalCheckoutError('webhook_state_missing', 'PayPal webhook state is unavailable.', 503);
    }
    const leaseCondition = existing.processedAt === null
      ? isNull(paypalWebhookEvents.processedAt)
      : eq(paypalWebhookEvents.processedAt, existing.processedAt);
    const reclaimed = await db.update(paypalWebhookEvents).set({
      status: 'retrying',
      processedAt: receivedAt,
    }).where(and(
      eq(paypalWebhookEvents.id, eventId),
      eq(paypalWebhookEvents.status, existing.status),
      leaseCondition,
    )).returning({ id: paypalWebhookEvents.id });
    if (reclaimed.length === 0) {
      throw new PayPalCheckoutError(
        'webhook_processing',
        'This PayPal webhook is still being processed.',
        503,
      );
    }
  }

  try {
    let result: { status: 'processed' | 'ignored' | 'deferred'; paymentId: string | null } = {
      status: 'ignored',
      paymentId: null,
    };
    if (captureEvent) {
      const payment = completedCapture ? await findPaymentForCapture(completedCapture) : null;
      if (completedCapture && payment) {
        await completeVerifiedCapture(payment, completedCapture);
        result = { status: 'processed', paymentId: payment.id };
      }
    } else if (reversal) {
      result = await reversePaymentFromWebhook(reversal);
      if (result.status === 'deferred') {
        await db.update(paypalWebhookEvents).set({
          status: 'deferred',
          processedAt: Date.now(),
        }).where(eq(paypalWebhookEvents.id, eventId));
        // Close the race where capture completion happened between the first
        // lookup and persisting this deferred event. If capture completes after
        // this retry, its reconciliation sees the already-deferred row.
        result = await reversePaymentFromWebhook(reversal);
        if (result.status === 'deferred') return result;
      }
    }
    await db.update(paypalWebhookEvents).set({
      paymentId: result.paymentId,
      status: result.status,
      processedAt: Date.now(),
    }).where(eq(paypalWebhookEvents.id, eventId));
    return result;
  } catch (error) {
    await db.update(paypalWebhookEvents).set({
      status: 'failed',
      processedAt: Date.now(),
    }).where(eq(paypalWebhookEvents.id, eventId));
    serverLogger.error({
      event: 'paypal.webhook.process.failed',
      webhookEventIdHash: hashForLog(eventId),
      webhookEventType: eventType,
      error: errorToLog(error),
    }, 'Failed to process verified PayPal webhook');
    throw error;
  }
}
