CREATE SCHEMA IF NOT EXISTS "notes_dev_identity";
--> statement-breakpoint
CREATE SCHEMA IF NOT EXISTS "notes";
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "notes_dev_identity"."couple_spaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "notes_dev_identity"."memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"space_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "notes"."notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"space_id" uuid NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"content" jsonb NOT NULL,
	"is_pinned" boolean DEFAULT false NOT NULL,
	"color" text DEFAULT 'none' NOT NULL,
	"category" text DEFAULT 'general' NOT NULL,
	"created_by" uuid NOT NULL,
	"updated_by" uuid NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "notes_dev_identity"."users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'memberships_user_id_users_id_fk') THEN
    ALTER TABLE "notes_dev_identity"."memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "notes_dev_identity"."users"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'memberships_space_id_couple_spaces_id_fk') THEN
    ALTER TABLE "notes_dev_identity"."memberships" ADD CONSTRAINT "memberships_space_id_couple_spaces_id_fk" FOREIGN KEY ("space_id") REFERENCES "notes_dev_identity"."couple_spaces"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notes_space_idx" ON "notes"."notes" USING btree ("space_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "notes_active_list_idx" ON "notes"."notes" USING btree ("space_id","is_pinned","updated_at") WHERE "notes"."notes"."deleted_at" IS NULL AND "notes"."notes"."archived_at" IS NULL;