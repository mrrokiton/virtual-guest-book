ALTER TABLE "weddings" ADD COLUMN "approved_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "weddings" ADD COLUMN "approved_by_user_id" text;--> statement-breakpoint
ALTER TABLE "weddings" ADD CONSTRAINT "weddings_approved_by_user_id_user_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
UPDATE "weddings" SET "approved_at" = "created_at" WHERE "status" <> 'draft';