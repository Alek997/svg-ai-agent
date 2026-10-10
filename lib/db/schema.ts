import { sql } from "drizzle-orm";
import { pgTable, uuid, text, integer, timestamp, boolean, jsonb, index, uniqueIndex, check, type AnyPgColumn } from "drizzle-orm/pg-core";
import type { StoredDetails } from "../conversations/contracts";
import type { SvgDocument } from "../workspace/types";

export const conversations = pgTable("conversations", {
  id: uuid().primaryKey(), ownerId: text("owner_id").notNull(), creationRequestId: uuid("creation_request_id").notNull(),
  title: text().notNull(), revision: integer().notNull().default(0), nextPosition: integer("next_position").notNull().default(1),
  activeRunId: uuid("active_run_id"), leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true, precision: 3 }),
  createdAt: timestamp("created_at", { withTimezone: true, precision: 3 }).notNull().defaultNow(), updatedAt: timestamp("updated_at", { withTimezone: true, precision: 3 }).notNull().defaultNow(),
}, table => [index("conversations_owner_updated").on(table.ownerId, table.updatedAt, table.id), uniqueIndex("conversations_creation_request").on(table.ownerId, table.creationRequestId)]);
export const messages = pgTable("messages", {
  id: uuid().primaryKey(), conversationId: uuid("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
  position: integer().notNull(), role: text().$type<"user" | "assistant">().notNull(), content: text().notNull().default(""),
  excludedFromContext: boolean("excluded_from_context").notNull().default(false), status: text().$type<"running" | "completed" | "error" | "interrupted">().notNull(),
  requestId: uuid("request_id"), userMessageId: uuid("user_message_id").references((): AnyPgColumn => messages.id), retryOf: uuid("retry_of").references((): AnyPgColumn => messages.id), error: text(),
  details: jsonb().$type<StoredDetails>().notNull(), createdAt: timestamp("created_at", { withTimezone: true, precision: 3 }).notNull().defaultNow(),
}, table => [uniqueIndex("messages_position").on(table.conversationId, table.position), uniqueIndex("messages_request").on(table.conversationId, table.requestId),
  check("messages_role", sql`${table.role} in ('user', 'assistant')`), check("messages_status", sql`${table.status} in ('running', 'completed', 'error', 'interrupted')`)]);
export const svgResults = pgTable("svg_results", {
  id: uuid().primaryKey(), assistantMessageId: uuid("assistant_message_id").notNull().references(() => messages.id, { onDelete: "cascade" }),
  document: jsonb().$type<SvgDocument>().notNull(), createdAt: timestamp("created_at", { withTimezone: true, precision: 3 }).notNull().defaultNow(),
}, table => [uniqueIndex("svg_results_assistant").on(table.assistantMessageId)]);
