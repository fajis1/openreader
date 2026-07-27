CREATE TABLE "system_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"severity" text NOT NULL,
	"context" text NOT NULL,
	"message" text NOT NULL,
	"details" text,
	"created_at" bigint DEFAULT (extract(epoch from now()) * 1000)::bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_api_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"key_hash" text NOT NULL,
	"key_last4" text NOT NULL,
	"expires_at" bigint,
	"created_at" bigint DEFAULT (extract(epoch from now()) * 1000)::bigint NOT NULL,
	"last_used_at" bigint,
	CONSTRAINT "user_api_keys_key_hash_unique" UNIQUE("key_hash")
);
--> statement-breakpoint
ALTER TABLE "audiobooks" ADD COLUMN "has_smart_audio" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "audiobooks" ADD COLUMN "total_bytes" bigint DEFAULT 0;--> statement-breakpoint
ALTER TABLE "user_api_keys" ADD CONSTRAINT "user_api_keys_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_user_api_keys_user_id" ON "user_api_keys" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_user_api_keys_hash" ON "user_api_keys" USING btree ("key_hash");