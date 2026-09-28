ALTER TABLE "exports" ADD COLUMN "notified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "media" ADD COLUMN "reprocess_attempts" integer DEFAULT 0 NOT NULL;