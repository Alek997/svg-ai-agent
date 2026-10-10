CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"owner_id" text NOT NULL,
	"creation_request_id" uuid NOT NULL,
	"title" text NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"next_position" integer DEFAULT 1 NOT NULL,
	"active_run_id" uuid,
	"lease_expires_at" timestamp (3) with time zone,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY NOT NULL,
	"conversation_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"role" text NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"excluded_from_context" boolean DEFAULT false NOT NULL,
	"status" text NOT NULL,
	"request_id" uuid,
	"user_message_id" uuid,
	"retry_of" uuid,
	"error" text,
	"details" jsonb NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "messages_role" CHECK ("messages"."role" in ('user', 'assistant')),
	CONSTRAINT "messages_status" CHECK ("messages"."status" in ('running', 'completed', 'error', 'interrupted'))
);
--> statement-breakpoint
CREATE TABLE "svg_results" (
	"id" uuid PRIMARY KEY NOT NULL,
	"assistant_message_id" uuid NOT NULL,
	"document" jsonb NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_user_message_id_messages_id_fk" FOREIGN KEY ("user_message_id") REFERENCES "public"."messages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_retry_of_messages_id_fk" FOREIGN KEY ("retry_of") REFERENCES "public"."messages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "svg_results" ADD CONSTRAINT "svg_results_assistant_message_id_messages_id_fk" FOREIGN KEY ("assistant_message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "conversations_owner_updated" ON "conversations" USING btree ("owner_id","updated_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "conversations_creation_request" ON "conversations" USING btree ("owner_id","creation_request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "messages_position" ON "messages" USING btree ("conversation_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "messages_request" ON "messages" USING btree ("conversation_id","request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "svg_results_assistant" ON "svg_results" USING btree ("assistant_message_id");