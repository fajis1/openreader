import { sql } from 'drizzle-orm';
import { pgTable, text, integer, real, date, bigint, boolean, primaryKey, index, uniqueIndex, jsonb, foreignKey, check } from 'drizzle-orm/pg-core';
import { user } from './schema_auth_postgres';

const PG_NOW_MS = sql`(extract(epoch from now()) * 1000)::bigint`;

export const documents = pgTable('documents', {
  id: text('id').notNull(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  type: text('type').notNull(), // pdf, epub, docx, html
  size: bigint('size', { mode: 'number' }).notNull(),
  lastModified: bigint('last_modified', { mode: 'number' }).notNull(),
  filePath: text('file_path').notNull(),
  createdAt: bigint('created_at', { mode: 'number' }).default(PG_NOW_MS),
}, (table) => [
  primaryKey({ columns: [table.id, table.userId] }),
  index('idx_documents_user_id').on(table.userId),
  index('idx_documents_user_id_last_modified').on(table.userId, table.lastModified),
]);

export const audiobooks = pgTable('audiobooks', {
  id: text('id').notNull(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  author: text('author'),
  description: text('description'),
  coverPath: text('cover_path'),
  duration: real('duration').default(0),
  hasSmartAudio: boolean('has_smart_audio').default(false),
  totalBytes: bigint('total_bytes', { mode: 'number' }).default(0),
  createdAt: bigint('created_at', { mode: 'number' }).default(PG_NOW_MS),
}, (table) => [
  primaryKey({ columns: [table.id, table.userId] }),
]);

export const audiobookJobs = pgTable('audiobook_jobs', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  documentId: text('document_id').notNull(),
  status: text('status').notNull().default('queued'), // queued, running, paused, completed, error
  progress: real('progress').default(0),
  settingsJson: jsonb('settings_json').notNull().default({}),
  createdAt: bigint('created_at', { mode: 'number' }).default(PG_NOW_MS),
  updatedAt: bigint('updated_at', { mode: 'number' }).default(PG_NOW_MS),
  startedAt: bigint('started_at', { mode: 'number' }),
  completedAt: bigint('completed_at', { mode: 'number' }),
  error: text('error'),
}, (table) => [
  index('idx_audiobook_jobs_status').on(table.status),
  index('idx_audiobook_jobs_user_id').on(table.userId),
]);

export const batchRefineRuns = pgTable('batch_refine_runs', {
  id: text('id').primaryKey(),
  jobId: text('job_id').notNull(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  documentId: text('document_id').notNull(),
  profileId: text('profile_id'),
  profileCategory: text('profile_category').notNull().default('standard'),
  rule: text('rule').notNull(),
  recordingMode: text('recording_mode').notNull().default('review'),
  holdHighPriority: boolean('hold_high_priority').notNull().default(true),
  status: text('status').notNull().default('queued'),
  totalChapters: integer('total_chapters').notNull().default(0),
  processedChapters: integer('processed_chapters').notNull().default(0),
  changedChapters: integer('changed_chapters').notNull().default(0),
  unchangedChapters: integer('unchanged_chapters').notNull().default(0),
  failedChapters: integer('failed_chapters').notNull().default(0),
  createdAt: bigint('created_at', { mode: 'number' }).notNull().default(PG_NOW_MS),
  updatedAt: bigint('updated_at', { mode: 'number' }).notNull().default(PG_NOW_MS),
  completedAt: bigint('completed_at', { mode: 'number' }),
}, (table) => [
  index('idx_batch_refine_runs_user_document_created').on(table.userId, table.documentId, table.createdAt),
  index('idx_batch_refine_runs_status_updated').on(table.status, table.updatedAt),
  uniqueIndex('idx_batch_refine_runs_job').on(table.jobId),
]);

export const batchRefineChanges = pgTable('batch_refine_changes', {
  id: text('id').primaryKey(),
  runId: text('run_id').notNull().references(() => batchRefineRuns.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  documentId: text('document_id').notNull(),
  chapterIndex: integer('chapter_index').notNull(),
  chapterTitle: text('chapter_title').notNull(),
  textFileName: text('text_file_name').notNull(),
  previousText: text('previous_text').notNull(),
  proposedText: text('proposed_text').notNull(),
  sourceTextHash: text('source_text_hash').notNull(),
  proposedTextHash: text('proposed_text_hash').notNull(),
  diffText: text('diff_text').notNull(),
  changedCharacters: integer('changed_characters').notNull().default(0),
  addedCharacters: integer('added_characters').notNull().default(0),
  removedCharacters: integer('removed_characters').notNull().default(0),
  changePercent: real('change_percent').notNull().default(0),
  reviewPriority: text('review_priority').notNull().default('low'),
  priorityScore: integer('priority_score').notNull().default(0),
  flagsJson: jsonb('flags_json').notNull().default([]),
  reviewNote: text('review_note'),
  decision: text('decision').notNull().default('pending'),
  edited: boolean('edited').notNull().default(false),
  audioStatus: text('audio_status').notNull().default('not_requested'),
  audioError: text('audio_error'),
  createdAt: bigint('created_at', { mode: 'number' }).notNull().default(PG_NOW_MS),
  updatedAt: bigint('updated_at', { mode: 'number' }).notNull().default(PG_NOW_MS),
  decidedAt: bigint('decided_at', { mode: 'number' }),
  audioCompletedAt: bigint('audio_completed_at', { mode: 'number' }),
}, (table) => [
  uniqueIndex('idx_batch_refine_changes_run_chapter').on(table.runId, table.chapterIndex),
  index('idx_batch_refine_changes_run_decision').on(table.runId, table.decision, table.chapterIndex),
  index('idx_batch_refine_changes_audio_status').on(table.audioStatus, table.updatedAt),
]);

export const audiobookChapters = pgTable('audiobook_chapters', {
  id: text('id').notNull(),
  bookId: text('book_id').notNull(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  chapterIndex: integer('chapter_index').notNull(),
  title: text('title').notNull(),
  duration: real('duration').default(0),
  filePath: text('file_path').notNull(),
  format: text('format').notNull(), // mp3, m4b
}, (table) => [
  primaryKey({ columns: [table.id, table.userId] }),
  foreignKey({
    columns: [table.bookId, table.userId],
    foreignColumns: [audiobooks.id, audiobooks.userId],
  }).onDelete('cascade'),
]);

// Auth tables (user, session, account, verification) are managed by Better Auth.
// They are created/migrated via `@better-auth/cli migrate` and should NOT be
// defined here. Only application-specific tables belong in this file.

export const userTtsChars = pgTable("user_tts_chars", {
  // Also stores device:* and ip:* backstop buckets, so this cannot reference user.id.
  userId: text('user_id').notNull(),
  date: date('date').notNull(),
  charCount: bigint('char_count', { mode: 'number' }).default(0),
  createdAt: bigint('created_at', { mode: 'number' }).default(PG_NOW_MS),
  updatedAt: bigint('updated_at', { mode: 'number' }).default(PG_NOW_MS),
}, (table) => [
  primaryKey({ columns: [table.userId, table.date] }),
  index('idx_user_tts_chars_date').on(table.date),
]);

// Generic per-user job-creation ledger for rate/concurrency limiting of
// expensive compute operations (e.g. PDF layout parsing). One row per created
// worker op. A trailing-window COUNT over (user_id, action) enforces both a
// short-window burst cap and a wider sustained/concurrency cap; because the
// worker bounds each op by a hard cap, "ops created in the last hard-cap
// window" is an upper bound on in-flight ops. Old rows are pruned opportunistically.
export const userJobEvents = pgTable('user_job_events', {
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  action: text('action').notNull(),
  opId: text('op_id').notNull(),
  createdAt: bigint('created_at', { mode: 'number' }).notNull().default(PG_NOW_MS),
}, (table) => [
  primaryKey({ columns: [table.userId, table.action, table.opId] }),
  index('idx_user_job_events_user_action_created').on(table.userId, table.action, table.createdAt),
]);

export const userPreferences = pgTable('user_preferences', {
  userId: text('user_id').primaryKey().references(() => user.id, { onDelete: 'cascade' }),
  dataJson: jsonb('data_json').notNull().default({}),
  clientUpdatedAtMs: bigint('client_updated_at_ms', { mode: 'number' }).notNull().default(0),
  createdAt: bigint('created_at', { mode: 'number' }).default(PG_NOW_MS),
  updatedAt: bigint('updated_at', { mode: 'number' }).default(PG_NOW_MS),
});

export const documentSettings = pgTable('document_settings', {
  documentId: text('document_id').notNull(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  dataJson: jsonb('data_json').notNull().default({}),
  clientUpdatedAtMs: bigint('client_updated_at_ms', { mode: 'number' }).notNull().default(0),
  createdAt: bigint('created_at', { mode: 'number' }).default(PG_NOW_MS),
  updatedAt: bigint('updated_at', { mode: 'number' }).default(PG_NOW_MS),
}, (table) => [
  primaryKey({ columns: [table.documentId, table.userId] }),
  index('idx_document_settings_user_id').on(table.userId),
]);

export const userDocumentProgress = pgTable('user_document_progress', {
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  documentId: text('document_id').notNull(),
  readerType: text('reader_type').notNull(), // pdf, epub, html
  location: text('location').notNull(),
  progress: real('progress'),
  clientUpdatedAtMs: bigint('client_updated_at_ms', { mode: 'number' }).notNull().default(0),
  createdAt: bigint('created_at', { mode: 'number' }).default(PG_NOW_MS),
  updatedAt: bigint('updated_at', { mode: 'number' }).default(PG_NOW_MS),
}, (table) => [
  primaryKey({ columns: [table.userId, table.documentId] }),
  index('idx_user_document_progress_user_id_updated_at').on(table.userId, table.updatedAt),
]);

export const documentPreviews = pgTable('document_previews', {
  documentId: text('document_id').notNull(),
  namespace: text('namespace').notNull().default(''),
  variant: text('variant').notNull(),
  status: text('status').notNull().default('queued'),
  sourceLastModifiedMs: bigint('source_last_modified_ms', { mode: 'number' }).notNull(),
  objectKey: text('object_key').notNull(),
  contentType: text('content_type').notNull().default('image/jpeg'),
  width: integer('width').notNull(),
  height: integer('height'),
  byteSize: bigint('byte_size', { mode: 'number' }),
  eTag: text('etag'),
  leaseOwner: text('lease_owner'),
  leaseUntilMs: bigint('lease_until_ms', { mode: 'number' }).notNull().default(0),
  attemptCount: integer('attempt_count').notNull().default(0),
  lastError: text('last_error'),
  createdAtMs: bigint('created_at_ms', { mode: 'number' }).notNull().default(0),
  updatedAtMs: bigint('updated_at_ms', { mode: 'number' }).notNull().default(0),
}, (table) => [
  primaryKey({ columns: [table.documentId, table.namespace, table.variant] }),
  index('idx_document_previews_status_lease').on(table.status, table.leaseUntilMs),
]);

export const ttsSegmentEntries = pgTable('tts_segment_entries', {
  segmentEntryId: text('segment_entry_id').notNull(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  documentId: text('document_id').notNull(),
  readerType: text('reader_type').notNull(),
  documentVersion: bigint('document_version', { mode: 'number' }).notNull(),
  segmentIndex: integer('segment_index').notNull(),
  segmentKey: text('segment_key'),
  locatorReaderRank: integer('locator_reader_rank').notNull(),
  locatorReaderType: text('locator_reader_type').notNull(),
  locatorPage: integer('locator_page').notNull(),
  locatorSpineIndex: integer('locator_spine_index').notNull(),
  locatorSpineHref: text('locator_spine_href').notNull(),
  locatorCharOffset: integer('locator_char_offset').notNull(),
  locatorLocation: text('locator_location').notNull(),
  locatorIdentityKey: text('locator_identity_key').notNull(),
  textHash: text('text_hash').notNull(),
  textLength: integer('text_length').notNull().default(0),
  createdAt: bigint('created_at', { mode: 'number' }).default(PG_NOW_MS),
  updatedAt: bigint('updated_at', { mode: 'number' }).default(PG_NOW_MS),
}, (table) => [
  primaryKey({ columns: [table.segmentEntryId, table.userId] }),
  index('idx_tts_segment_entries_manifest_sort').on(
    table.userId,
    table.documentId,
    table.documentVersion,
    table.locatorReaderRank,
    table.locatorSpineIndex,
    table.locatorCharOffset,
    table.locatorSpineHref,
    table.locatorPage,
    table.locatorLocation,
    table.segmentIndex,
    table.locatorIdentityKey,
  ),
  index('idx_tts_segment_entries_manifest_group').on(
    table.userId,
    table.documentId,
    table.documentVersion,
    table.segmentIndex,
    table.locatorIdentityKey,
  ),
  index('idx_tts_segment_entries_scope').on(
    table.userId,
    table.documentId,
    table.documentVersion,
  ),
]);

export const adminProviders = pgTable('admin_providers', {
  id: text('id').primaryKey(),
  slug: text('slug').notNull().unique(),
  displayName: text('display_name').notNull(),
  providerType: text('provider_type').notNull(),
  baseUrl: text('base_url'),
  apiKeyCiphertext: text('api_key_ciphertext').notNull(),
  apiKeyIv: text('api_key_iv').notNull(),
  apiKeyLast4: text('api_key_last4'),
  defaultModel: text('default_model'),
  defaultInstructions: text('default_instructions'),
  enabled: integer('enabled').notNull().default(1),
  createdAt: bigint('created_at', { mode: 'number' }).notNull().default(PG_NOW_MS),
  updatedAt: bigint('updated_at', { mode: 'number' }).notNull().default(PG_NOW_MS),
});

export const adminSettings = pgTable('admin_settings', {
  key: text('key').primaryKey(),
  valueJson: jsonb('value_json').notNull(),
  source: text('source').notNull().default('admin'),
  updatedAt: bigint('updated_at', { mode: 'number' }).notNull().default(PG_NOW_MS),
});

export const scheduledTasks = pgTable('scheduled_tasks', {
  key: text('key').primaryKey(),
  enabled: boolean('enabled').notNull().default(true),
  intervalMs: bigint('interval_ms', { mode: 'number' }).notNull(),
  lastStatus: text('last_status').notNull().default('idle'),
  leaseOwner: text('lease_owner'),
  lastRunAt: bigint('last_run_at', { mode: 'number' }),
  lastDurationMs: bigint('last_duration_ms', { mode: 'number' }),
  lastError: text('last_error'),
  lastResultJson: text('last_result_json'),
  nextRunAt: bigint('next_run_at', { mode: 'number' }),
  runRequested: boolean('run_requested').notNull().default(false),
  runningSince: bigint('running_since', { mode: 'number' }),
  updatedAt: bigint('updated_at', { mode: 'number' }).notNull().default(PG_NOW_MS),
}, (table) => [
  check('scheduled_tasks_interval_ms_positive', sql`${table.intervalMs} > 0`),
]);

export const documentBlobLeases = pgTable('document_blob_leases', {
  documentId: text('document_id').primaryKey(),
  leaseOwner: text('lease_owner').notNull(),
  leaseUntilMs: bigint('lease_until_ms', { mode: 'number' }).notNull(),
});

export const userApiKeys = pgTable('user_api_keys', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  keyHash: text('key_hash').notNull().unique(),
  keyLast4: text('key_last4').notNull(),
  expiresAt: bigint('expires_at', { mode: 'number' }),
  createdAt: bigint('created_at', { mode: 'number' }).notNull().default(PG_NOW_MS),
  lastUsedAt: bigint('last_used_at', { mode: 'number' }),
}, (table) => [
  index('idx_user_api_keys_user_id').on(table.userId),
  index('idx_user_api_keys_hash').on(table.keyHash),
]);

export const ttsSegmentVariants = pgTable('tts_segment_variants', {
  segmentId: text('segment_id').notNull(),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  segmentEntryId: text('segment_entry_id').notNull(),
  settingsHash: text('settings_hash').notNull(),
  settingsJson: jsonb('settings_json').notNull(),
  audioKey: text('audio_key'),
  audioFormat: text('audio_format').notNull().default('mp3'),
  durationMs: integer('duration_ms'),
  alignmentJson: text('alignment_json'),
  status: text('status').notNull().default('pending'),
  error: text('error'),
  createdAt: bigint('created_at', { mode: 'number' }).default(PG_NOW_MS),
  updatedAt: bigint('updated_at', { mode: 'number' }).default(PG_NOW_MS),
}, (table) => [
  primaryKey({ columns: [table.segmentId, table.userId] }),
  foreignKey({
    columns: [table.segmentEntryId, table.userId],
    foreignColumns: [ttsSegmentEntries.segmentEntryId, ttsSegmentEntries.userId],
  }).onDelete('cascade'),
  index('idx_tts_segment_variants_entry').on(table.userId, table.segmentEntryId, table.updatedAt),
  index('idx_tts_segment_variants_status').on(table.userId, table.status),
  index('idx_tts_segment_variants_unique_settings').on(table.userId, table.segmentEntryId, table.settingsHash),
]);

export const systemLogs = pgTable('system_logs', {
  id: text('id').primaryKey(),
  userId: text('user_id'),
  severity: text('severity').notNull(),
  context: text('context').notNull(),
  message: text('message').notNull(),
  details: text('details'),
  createdAt: bigint('created_at', { mode: 'number' }).notNull().default(PG_NOW_MS),
});

export const supportPayments = pgTable('support_payments', {
  id: text('id').primaryKey(),
  // Deliberately not a foreign key: financial/audit records must survive an
  // account deletion even though they contain no payer name, email, or address.
  userId: text('user_id').notNull(),
  environment: text('environment').notNull(),
  paypalOrderId: text('paypal_order_id').unique(),
  paypalCaptureId: text('paypal_capture_id').unique(),
  status: text('status').notNull().default('creating'),
  amountCents: integer('amount_cents').notNull(),
  currency: text('currency').notNull().default('USD'),
  credits: integer('credits').notNull(),
  creditsGranted: integer('credits_granted').notNull().default(0),
  creditsRevoked: integer('credits_revoked').notNull().default(0),
  reversalShortfall: integer('reversal_shortfall').notNull().default(0),
  failureCode: text('failure_code'),
  createdAt: bigint('created_at', { mode: 'number' }).notNull().default(PG_NOW_MS),
  updatedAt: bigint('updated_at', { mode: 'number' }).notNull().default(PG_NOW_MS),
  completedAt: bigint('completed_at', { mode: 'number' }),
  reversedAt: bigint('reversed_at', { mode: 'number' }),
}, (table) => [
  index('idx_support_payments_user_created').on(table.userId, table.createdAt),
  index('idx_support_payments_status_updated').on(table.status, table.updatedAt),
]);

export const supportAuditEvents = pgTable('support_audit_events', {
  id: text('id').primaryKey(),
  // Deliberately not foreign keys so support history survives account deletion.
  adminUserId: text('admin_user_id').notNull(),
  targetUserId: text('target_user_id'),
  action: text('action').notNull(),
  resourceId: text('resource_id'),
  amount: integer('amount'),
  note: text('note'),
  createdAt: bigint('created_at', { mode: 'number' }).notNull().default(PG_NOW_MS),
}, (table) => [
  index('idx_support_audit_created').on(table.createdAt),
  index('idx_support_audit_target_created').on(table.targetUserId, table.createdAt),
]);

export const paypalWebhookEvents = pgTable('paypal_webhook_events', {
  id: text('id').primaryKey(),
  eventType: text('event_type').notNull(),
  paymentId: text('payment_id'),
  resourceId: text('resource_id'),
  captureId: text('capture_id'),
  orderId: text('order_id'),
  customId: text('custom_id'),
  amountCents: integer('amount_cents'),
  currency: text('currency'),
  status: text('status').notNull().default('received'),
  createdAt: bigint('created_at', { mode: 'number' }).notNull().default(PG_NOW_MS),
  processedAt: bigint('processed_at', { mode: 'number' }),
}, (table) => [
  index('idx_paypal_webhook_events_payment').on(table.paymentId, table.createdAt),
  index('idx_paypal_webhook_events_capture_status').on(table.captureId, table.status),
]);
