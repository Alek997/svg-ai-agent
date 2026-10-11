CREATE EXTENSION IF NOT EXISTS vector;
--> statement-breakpoint
CREATE TABLE "collection_icons" (
	"id" uuid PRIMARY KEY NOT NULL,
	"collection_id" uuid NOT NULL,
	"owner_id" text NOT NULL,
	"filename" text NOT NULL,
	"source" text NOT NULL,
	"hash" text NOT NULL,
	"description" text,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"embedding" vector(1536),
	"embedding_model" text,
	"embedding_dimensions" integer,
	"description_model" text,
	"version" text DEFAULT 'png-description-v1' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"description_attempts" integer DEFAULT 0 NOT NULL,
	"embedding_attempts" integer DEFAULT 0 NOT NULL,
	"claim_id" uuid,
	"claim_expires_at" timestamp with time zone,
	"error" text,
	"usage" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "collection_icons_status" CHECK ("collection_icons"."status" in ('pending', 'described', 'ready', 'description_error', 'embedding_error'))
);
--> statement-breakpoint
CREATE TABLE "collection_references" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"assistant_message_id" uuid NOT NULL,
	"icon_id" uuid,
	"hash" text NOT NULL,
	"source" text
);
--> statement-breakpoint
CREATE TABLE "collection_usage" (
	"owner_id" text NOT NULL,
	"kind" text NOT NULL,
	"window" text NOT NULL,
	"count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "collections" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "collection_id" uuid;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "private" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "collection_icons" ADD CONSTRAINT "collection_icons_collection_id_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."collections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_references" ADD CONSTRAINT "collection_references_assistant_message_id_messages_id_fk" FOREIGN KEY ("assistant_message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_references" ADD CONSTRAINT "collection_references_icon_id_collection_icons_id_fk" FOREIGN KEY ("icon_id") REFERENCES "public"."collection_icons"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "collection_icons_hash" ON "collection_icons" USING btree ("collection_id","hash");--> statement-breakpoint
CREATE INDEX "collection_icons_owner" ON "collection_icons" USING btree ("owner_id","collection_id");--> statement-breakpoint
CREATE INDEX "collection_references_message" ON "collection_references" USING btree ("assistant_message_id");--> statement-breakpoint
CREATE UNIQUE INDEX "collection_usage_window" ON "collection_usage" USING btree ("owner_id","kind","window");--> statement-breakpoint
CREATE INDEX "collections_owner" ON "collections" USING btree ("owner_id");--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_collection_id_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."collections"("id") ON DELETE set null ON UPDATE no action;