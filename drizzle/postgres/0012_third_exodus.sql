CREATE TABLE "audiobook_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"document_id" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"progress" real DEFAULT 0,
	"settings_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" bigint DEFAULT (extract(epoch from now()) * 1000)::bigint,
	"updated_at" bigint DEFAULT (extract(epoch from now()) * 1000)::bigint,
	"started_at" bigint,
	"completed_at" bigint,
	"error" text
);
--> statement-breakpoint
ALTER TABLE "audiobook_jobs" ADD CONSTRAINT "audiobook_jobs_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_audiobook_jobs_status" ON "audiobook_jobs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_audiobook_jobs_user_id" ON "audiobook_jobs" USING btree ("user_id");