CREATE TABLE "music_suggestions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wedding_id" uuid NOT NULL,
	"guest_session_id" uuid,
	"author_name" text,
	"kind" text NOT NULL,
	"body" text NOT NULL,
	"body_key" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"queue_rank" integer,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status_changed_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wedding_dj_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wedding_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"label" text,
	"created_by_user_id" text,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "guest_sessions" ADD COLUMN "role" text DEFAULT 'guest' NOT NULL;--> statement-breakpoint
ALTER TABLE "guest_sessions" ADD COLUMN "dj_link_id" uuid;--> statement-breakpoint
ALTER TABLE "music_suggestions" ADD CONSTRAINT "music_suggestions_wedding_id_weddings_id_fk" FOREIGN KEY ("wedding_id") REFERENCES "public"."weddings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "music_suggestions" ADD CONSTRAINT "music_suggestions_guest_session_id_guest_sessions_id_fk" FOREIGN KEY ("guest_session_id") REFERENCES "public"."guest_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wedding_dj_links" ADD CONSTRAINT "wedding_dj_links_wedding_id_weddings_id_fk" FOREIGN KEY ("wedding_id") REFERENCES "public"."weddings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wedding_dj_links" ADD CONSTRAINT "wedding_dj_links_created_by_user_id_user_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "music_suggestions_queue_idx" ON "music_suggestions" USING btree ("wedding_id","deleted_at","status","queue_rank");--> statement-breakpoint
CREATE INDEX "music_suggestions_session_idx" ON "music_suggestions" USING btree ("guest_session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "wedding_dj_links_token_idx" ON "wedding_dj_links" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "wedding_dj_links_wedding_idx" ON "wedding_dj_links" USING btree ("wedding_id");--> statement-breakpoint
ALTER TABLE "guest_sessions" ADD CONSTRAINT "guest_sessions_dj_link_id_wedding_dj_links_id_fk" FOREIGN KEY ("dj_link_id") REFERENCES "public"."wedding_dj_links"("id") ON DELETE set null ON UPDATE no action;