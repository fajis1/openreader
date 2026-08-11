CREATE TABLE "support_audit_events" (
	"id" text PRIMARY KEY NOT NULL,
	"admin_user_id" text NOT NULL,
	"target_user_id" text,
	"action" text NOT NULL,
	"resource_id" text,
	"amount" integer,
	"note" text,
	"created_at" bigint DEFAULT (extract(epoch from now()) * 1000)::bigint NOT NULL
);
--> statement-breakpoint
CREATE INDEX "idx_support_audit_created" ON "support_audit_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_support_audit_target_created" ON "support_audit_events" USING btree ("target_user_id","created_at");