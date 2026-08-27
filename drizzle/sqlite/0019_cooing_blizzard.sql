CREATE TABLE `batch_refine_changes` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`user_id` text NOT NULL,
	`document_id` text NOT NULL,
	`chapter_index` integer NOT NULL,
	`chapter_title` text NOT NULL,
	`text_file_name` text NOT NULL,
	`previous_text` text NOT NULL,
	`proposed_text` text NOT NULL,
	`source_text_hash` text NOT NULL,
	`proposed_text_hash` text NOT NULL,
	`diff_text` text NOT NULL,
	`changed_characters` integer DEFAULT 0 NOT NULL,
	`added_characters` integer DEFAULT 0 NOT NULL,
	`removed_characters` integer DEFAULT 0 NOT NULL,
	`change_percent` real DEFAULT 0 NOT NULL,
	`review_priority` text DEFAULT 'low' NOT NULL,
	`priority_score` integer DEFAULT 0 NOT NULL,
	`flags_json` text DEFAULT '[]' NOT NULL,
	`review_note` text,
	`decision` text DEFAULT 'pending' NOT NULL,
	`edited` integer DEFAULT false NOT NULL,
	`audio_status` text DEFAULT 'not_requested' NOT NULL,
	`audio_error` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`decided_at` integer,
	`audio_completed_at` integer,
	FOREIGN KEY (`run_id`) REFERENCES `batch_refine_runs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_batch_refine_changes_run_chapter` ON `batch_refine_changes` (`run_id`,`chapter_index`);--> statement-breakpoint
CREATE INDEX `idx_batch_refine_changes_run_decision` ON `batch_refine_changes` (`run_id`,`decision`,`chapter_index`);--> statement-breakpoint
CREATE INDEX `idx_batch_refine_changes_audio_status` ON `batch_refine_changes` (`audio_status`,`updated_at`);--> statement-breakpoint
CREATE TABLE `batch_refine_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`user_id` text NOT NULL,
	`document_id` text NOT NULL,
	`profile_id` text,
	`profile_category` text DEFAULT 'standard' NOT NULL,
	`rule` text NOT NULL,
	`recording_mode` text DEFAULT 'review' NOT NULL,
	`hold_high_priority` integer DEFAULT true NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`total_chapters` integer DEFAULT 0 NOT NULL,
	`processed_chapters` integer DEFAULT 0 NOT NULL,
	`changed_chapters` integer DEFAULT 0 NOT NULL,
	`unchanged_chapters` integer DEFAULT 0 NOT NULL,
	`failed_chapters` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`completed_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_batch_refine_runs_user_document_created` ON `batch_refine_runs` (`user_id`,`document_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_batch_refine_runs_status_updated` ON `batch_refine_runs` (`status`,`updated_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_batch_refine_runs_job` ON `batch_refine_runs` (`job_id`);