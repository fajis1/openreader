CREATE TABLE `audiobook_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`document_id` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`progress` real DEFAULT 0,
	`settings_json` text DEFAULT '{}' NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)),
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)),
	`started_at` integer,
	`completed_at` integer,
	`error` text,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_audiobook_jobs_status` ON `audiobook_jobs` (`status`);--> statement-breakpoint
CREATE INDEX `idx_audiobook_jobs_user_id` ON `audiobook_jobs` (`user_id`);