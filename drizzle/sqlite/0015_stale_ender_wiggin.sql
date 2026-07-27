CREATE TABLE `system_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`severity` text NOT NULL,
	`context` text NOT NULL,
	`message` text NOT NULL,
	`details` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `user_api_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`key_hash` text NOT NULL,
	`key_last4` text NOT NULL,
	`expires_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`last_used_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_api_keys_key_hash_unique` ON `user_api_keys` (`key_hash`);--> statement-breakpoint
CREATE INDEX `idx_user_api_keys_user_id` ON `user_api_keys` (`user_id`);--> statement-breakpoint
CREATE INDEX `idx_user_api_keys_hash` ON `user_api_keys` (`key_hash`);