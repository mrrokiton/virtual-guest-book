CREATE TABLE "bingo_submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wedding_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"guest_session_id" uuid NOT NULL,
	"media_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"rejection_reason" text,
	"submitted_at" timestamp (3) with time zone,
	"verified_at" timestamp with time zone,
	"verified_by_user_id" text,
	"withdrawn_at" timestamp with time zone,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bingo_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wedding_id" uuid NOT NULL,
	"body" text NOT NULL,
	"position" integer NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bingo_validators" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wedding_id" uuid NOT NULL,
	"full_name" text NOT NULL,
	"nickname" text,
	"position" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bingo_submissions" ADD CONSTRAINT "bingo_submissions_wedding_id_weddings_id_fk" FOREIGN KEY ("wedding_id") REFERENCES "public"."weddings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bingo_submissions" ADD CONSTRAINT "bingo_submissions_task_id_bingo_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."bingo_tasks"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bingo_submissions" ADD CONSTRAINT "bingo_submissions_guest_session_id_guest_sessions_id_fk" FOREIGN KEY ("guest_session_id") REFERENCES "public"."guest_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bingo_submissions" ADD CONSTRAINT "bingo_submissions_media_id_media_id_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bingo_submissions" ADD CONSTRAINT "bingo_submissions_verified_by_user_id_user_id_fk" FOREIGN KEY ("verified_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bingo_tasks" ADD CONSTRAINT "bingo_tasks_wedding_id_weddings_id_fk" FOREIGN KEY ("wedding_id") REFERENCES "public"."weddings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bingo_validators" ADD CONSTRAINT "bingo_validators_wedding_id_weddings_id_fk" FOREIGN KEY ("wedding_id") REFERENCES "public"."weddings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "bingo_submissions_media_idx" ON "bingo_submissions" USING btree ("media_id");--> statement-breakpoint
CREATE UNIQUE INDEX "bingo_submissions_active_idx" ON "bingo_submissions" USING btree ("wedding_id","task_id","guest_session_id") WHERE "bingo_submissions"."withdrawn_at" is null;--> statement-breakpoint
CREATE INDEX "bingo_submissions_queue_idx" ON "bingo_submissions" USING btree ("wedding_id","status","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "bingo_submissions_guest_idx" ON "bingo_submissions" USING btree ("wedding_id","guest_session_id");--> statement-breakpoint
CREATE INDEX "bingo_tasks_wedding_idx" ON "bingo_tasks" USING btree ("wedding_id","archived_at","position");--> statement-breakpoint
CREATE UNIQUE INDEX "bingo_tasks_wedding_id_idx" ON "bingo_tasks" USING btree ("wedding_id","id");--> statement-breakpoint
CREATE INDEX "bingo_validators_wedding_idx" ON "bingo_validators" USING btree ("wedding_id","position");