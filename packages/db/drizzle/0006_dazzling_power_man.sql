CREATE TABLE "bingo_progress" (
	"wedding_id" uuid NOT NULL,
	"guest_session_id" uuid NOT NULL,
	"photos_completed_at" timestamp (3) with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bingo_progress_wedding_id_guest_session_id_pk" PRIMARY KEY("wedding_id","guest_session_id")
);
--> statement-breakpoint
DROP INDEX "bingo_submissions_active_idx";--> statement-breakpoint
ALTER TABLE "bingo_progress" ADD CONSTRAINT "bingo_progress_wedding_id_weddings_id_fk" FOREIGN KEY ("wedding_id") REFERENCES "public"."weddings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bingo_progress" ADD CONSTRAINT "bingo_progress_guest_session_id_guest_sessions_id_fk" FOREIGN KEY ("guest_session_id") REFERENCES "public"."guest_sessions"("id") ON DELETE cascade ON UPDATE no action;