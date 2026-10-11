import { sql } from "drizzle-orm";
import { pgTable, uuid, text, integer, timestamp, boolean, jsonb, index, uniqueIndex, check, vector, type AnyPgColumn } from "drizzle-orm/pg-core";
import type { StoredDetails } from "../conversations/contracts";
import type { SvgDocument } from "../workspace/types";

export const conversations = pgTable("conversations", {
  id: uuid().primaryKey(), ownerId: text("owner_id").notNull(), creationRequestId: uuid("creation_request_id").notNull(),
  collectionId: uuid("collection_id").references(() => collections.id, { onDelete: "set null" }), private: boolean().notNull().default(false),
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
  publicId: text("public_id").notNull().default(sql`translate(encode(substring(uuid_send(gen_random_uuid()) from 8 for 9), 'base64'), '+/', '-_')`),
  document: jsonb().$type<SvgDocument>().notNull(), createdAt: timestamp("created_at", { withTimezone: true, precision: 3 }).notNull().defaultNow(),
}, table => [uniqueIndex("svg_results_assistant").on(table.assistantMessageId), uniqueIndex("svg_results_public_id").on(table.publicId),
  check("svg_results_public_id_format", sql`${table.publicId} ~ '^[A-Za-z0-9_-]{12}$'`)]);

export const collections = pgTable("collections", {
  id: uuid().primaryKey(), ownerId: text("owner_id").notNull(), name: text().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [index("collections_owner").on(t.ownerId)]);
export const collectionIcons = pgTable("collection_icons", {
  id: uuid().primaryKey(), collectionId: uuid("collection_id").notNull().references(() => collections.id, { onDelete: "cascade" }),
  ownerId: text("owner_id").notNull(), filename: text().notNull(), source: text().notNull(), hash: text().notNull(),
  description: text(), tags: jsonb().$type<string[]>().notNull().default([]),
  embedding: vector({ dimensions: 1536 }), embeddingModel: text("embedding_model"), embeddingDimensions: integer("embedding_dimensions"),
  descriptionModel: text("description_model"), version: text().notNull().default("png-description-v1"),
  status: text().notNull().default("pending"), descriptionAttempts: integer("description_attempts").notNull().default(0), embeddingAttempts: integer("embedding_attempts").notNull().default(0),
  claimId: uuid("claim_id"), claimExpiresAt: timestamp("claim_expires_at", { withTimezone: true }), error: text(),
  usage: jsonb().$type<Record<string, unknown>[]>().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [uniqueIndex("collection_icons_hash").on(t.collectionId, t.hash), index("collection_icons_owner").on(t.ownerId, t.collectionId),
  check("collection_icons_status", sql`${t.status} in ('pending', 'described', 'ready', 'description_error', 'embedding_error')`)]);
export const collectionUsage = pgTable("collection_usage", {
  ownerId: text("owner_id").notNull(), kind: text().notNull(), window: text().notNull(), count: integer().notNull().default(0),
}, t => [uniqueIndex("collection_usage_window").on(t.ownerId, t.kind, t.window)]);
// Copies are kept separately so deleting a source scrubs historical previews too.
export const collectionReferences = pgTable("collection_references", {
  id: uuid().primaryKey(), ownerId: text("owner_id").notNull(),
  assistantMessageId: uuid("assistant_message_id").notNull().references(() => messages.id, { onDelete: "cascade" }),
  iconId: uuid("icon_id").references(() => collectionIcons.id, { onDelete: "set null" }), hash: text().notNull(), source: text(),
}, t => [index("collection_references_message").on(t.assistantMessageId)]);
