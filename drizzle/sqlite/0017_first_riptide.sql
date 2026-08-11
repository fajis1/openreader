CREATE TABLE `paypal_webhook_events` (
	`id` text PRIMARY KEY NOT NULL,
	`event_type` text NOT NULL,
	`payment_id` text,
	`resource_id` text,
	`capture_id` text,
	`order_id` text,
	`custom_id` text,
	`amount_cents` integer,
	`currency` text,
	`status` text DEFAULT 'received' NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`processed_at` integer
);
--> statement-breakpoint
CREATE INDEX `idx_paypal_webhook_events_payment` ON `paypal_webhook_events` (`payment_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_paypal_webhook_events_capture_status` ON `paypal_webhook_events` (`capture_id`,`status`);--> statement-breakpoint
CREATE TABLE `support_payments` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`environment` text NOT NULL,
	`paypal_order_id` text,
	`paypal_capture_id` text,
	`status` text DEFAULT 'creating' NOT NULL,
	`amount_cents` integer NOT NULL,
	`currency` text DEFAULT 'USD' NOT NULL,
	`credits` integer NOT NULL,
	`credits_granted` integer DEFAULT 0 NOT NULL,
	`credits_revoked` integer DEFAULT 0 NOT NULL,
	`reversal_shortfall` integer DEFAULT 0 NOT NULL,
	`failure_code` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`completed_at` integer,
	`reversed_at` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `support_payments_paypal_order_id_unique` ON `support_payments` (`paypal_order_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `support_payments_paypal_capture_id_unique` ON `support_payments` (`paypal_capture_id`);--> statement-breakpoint
CREATE INDEX `idx_support_payments_user_created` ON `support_payments` (`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_support_payments_status_updated` ON `support_payments` (`status`,`updated_at`);