import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { and, eq, sql, asc } from "drizzle-orm";
import { withDatabase } from "../db/client";
import {
  collections,
  collectionIcons as icons,
  collectionUsage,
  collectionReferences,
  conversations,
  messages,
  svgResults,
} from "../db/schema";
import { ConversationError } from "../conversations/errors";
import {
  COLLECTION_LIMITS as limits,
  iconUploadSchema,
  type CollectionSummary,
} from "./contracts";

type Database = Parameters<Parameters<typeof withDatabase>[0]>[0];
export type CollectionTransaction = Parameters<
  Parameters<Database["transaction"]>[0]
>[0];
export async function lockCollection(
  tx: CollectionTransaction,
  ownerId: string,
  id: string,
) {
  const [row] = await tx
    .select()
    .from(collections)
    .where(and(eq(collections.id, id), eq(collections.ownerId, ownerId)))
    .for("update");
  if (!row) throw new ConversationError("Collection not found.", 404);
  return row;
}
// Serialize per-owner creation even when they have no rows yet.
export async function lockOwner(tx: CollectionTransaction, ownerId: string) {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${ownerId}, 0))`,
  );
}
export async function consumeUsage(
  tx: CollectionTransaction,
  ownerId: string,
  kind: "analysis" | "search",
  amount = 1,
) {
  const window = new Date()
    .toISOString()
    .slice(0, kind === "analysis" ? 10 : 13);
  const limit =
    kind === "analysis" ? limits.dailyAnalysis : limits.hourlySearch;
  const rows = await tx
    .insert(collectionUsage)
    .values({ ownerId, kind, window, count: amount })
    .onConflictDoUpdate({
      target: [
        collectionUsage.ownerId,
        collectionUsage.kind,
        collectionUsage.window,
      ],
      set: { count: sql`${collectionUsage.count} + ${amount}` },
      setWhere: sql`${collectionUsage.count} + ${amount} <= ${limit}`,
    })
    .returning();
  if (!rows.length || amount > limit)
    throw new ConversationError(
      `Collection ${kind} limit reached. Try again next ${kind === "analysis" ? "day" : "hour"}.`,
      429,
    );
}
async function insertIcon(
  tx: CollectionTransaction,
  ownerId: string,
  collectionId: string,
  raw: unknown,
) {
  const parsed = iconUploadSchema.safeParse(raw);
  if (!parsed.success)
    throw new ConversationError(parsed.error.issues[0].message, 400);
  const { filename, source } = parsed.data;
  const hash = createHash("sha256").update(source).digest("hex");
  const [duplicate] = await tx
    .select({ id: icons.id })
    .from(icons)
    .where(
      and(
        eq(icons.collectionId, collectionId),
        eq(icons.ownerId, ownerId),
        eq(icons.hash, hash),
      ),
    );
  if (duplicate) return { id: duplicate.id, duplicate: true };
  const [{ count }] = await tx
    .select({ count: sql<number>`count(*)::int` })
    .from(icons)
    .where(eq(icons.collectionId, collectionId));
  if (count >= limits.icons)
    throw new ConversationError(
      "A collection can contain at most 200 icons.",
      409,
    );
  const id = randomUUID();
  await tx
    .insert(icons)
    .values({ id, collectionId, ownerId, filename, source, hash });
  return { id, duplicate: false };
}
// All entry points receive the authenticated owner, never a body-supplied owner.
export function createCollectionStore(runDatabase = withDatabase) {
  return {
    async list(ownerId: string): Promise<CollectionSummary[]> {
      return runDatabase((db) =>
        db
          .select({
            id: collections.id,
            name: collections.name,
            total: sql<number>`count(${icons.id})::int`,
            ready: sql<number>`count(${icons.id}) filter (where ${icons.status} = 'ready')::int`,
          })
          .from(collections)
          .leftJoin(icons, eq(icons.collectionId, collections.id))
          .where(eq(collections.ownerId, ownerId))
          .groupBy(collections.id)
          .orderBy(asc(collections.createdAt)),
      );
    },
    async create(ownerId: string, name: string) {
      return runDatabase((db) =>
        db.transaction(async (tx) => {
          await lockOwner(tx, ownerId);
          const [{ count }] = await tx
            .select({ count: sql<number>`count(*)::int` })
            .from(collections)
            .where(eq(collections.ownerId, ownerId));
          if (count >= limits.collections)
            throw new ConversationError(
              "You can create at most five collections.",
              409,
            );
          const [row] = await tx
            .insert(collections)
            .values({ id: randomUUID(), ownerId, name })
            .returning();
          return row;
        }),
      );
    },
    async page(ownerId: string, id: string) {
      return runDatabase((db) =>
        db.transaction(async (tx) => {
          const collection = await lockCollection(tx, ownerId, id);
          const rows = await tx
            .select()
            .from(icons)
            .where(and(eq(icons.collectionId, id), eq(icons.ownerId, ownerId)))
            .orderBy(asc(icons.createdAt), asc(icons.id));
          return {
            collection: { id, name: collection.name },
            icons: rows.map((row) => ({
              id: row.id,
              filename: row.filename,
              source: row.source,
              hash: row.hash,
              description: row.description,
              tags: row.tags,
              status: row.status,
              descriptionAttempts: row.descriptionAttempts,
              embeddingAttempts: row.embeddingAttempts,
              error: row.error,
              claimExpiresAt: row.claimExpiresAt,
              embeddingModel: row.embeddingModel,
              usage: row.usage,
            })),
          };
        }),
      );
    },
    async upload(ownerId: string, id: string, files: unknown[]) {
      // One transaction per file permits honest partial successes.
      const results = [];
      for (const file of files) {
        try {
          results.push({
            ok: true,
            ...(await runDatabase((db) =>
              db.transaction(async (tx) => {
                await lockCollection(tx, ownerId, id);
                return insertIcon(tx, ownerId, id, file);
              }),
            )),
          });
        } catch (error) {
          if (!(error instanceof ConversationError)) throw error;
          results.push({ ok: false, error: error.message });
        }
      }
      return { results };
    },
    async retry(ownerId: string, id: string, iconId: string, reindex = false) {
      return runDatabase((db) =>
        db.transaction(async (tx) => {
          await lockCollection(tx, ownerId, id);
          const [row] = await tx
            .select()
            .from(icons)
            .where(
              and(
                eq(icons.id, iconId),
                eq(icons.collectionId, id),
                eq(icons.ownerId, ownerId),
              ),
            )
            .for("update");
          if (!row) throw new ConversationError("Icon not found.", 404);
          if (row.claimExpiresAt && row.claimExpiresAt > new Date())
            throw new ConversationError("This icon is being processed.", 409);
          const embeddingStage = !!row.description;
          const attempts = embeddingStage
            ? row.embeddingAttempts
            : row.descriptionAttempts;
          if (
            !reindex &&
            (!row.status.endsWith("_error") || attempts >= limits.attempts)
          )
            throw new ConversationError(
              "This stage cannot be retried (maximum three attempts).",
              409,
            );
          if (reindex && row.status !== "ready")
            throw new ConversationError(
              "Only searchable icons can be reindexed.",
              409,
            );
          await tx
            .update(icons)
            .set({
              status: embeddingStage ? "described" : "pending",
              embedding: null,
              embeddingModel: null,
              embeddingDimensions: null,
              error: null,
              claimId: null,
              claimExpiresAt: null,
              ...(reindex ? { embeddingAttempts: 0 } : {}),
            })
            .where(eq(icons.id, iconId));
        }),
      );
    },
    async remove(ownerId: string, id: string, iconId?: string) {
      await runDatabase((db) =>
        db.transaction(async (tx) => {
          await lockCollection(tx, ownerId, id);
          const filter = and(
            eq(icons.ownerId, ownerId),
            eq(icons.collectionId, id),
            iconId ? eq(icons.id, iconId) : undefined,
          );
          const selected = await tx
            .select({ id: icons.id })
            .from(icons)
            .where(filter);
          if (iconId && !selected.length)
            throw new ConversationError("Icon not found.", 404);
          // Sources cannot survive deletion in retained run references.
          for (const icon of selected)
            await tx
              .update(collectionReferences)
              .set({ source: null })
              .where(
                and(
                  eq(collectionReferences.ownerId, ownerId),
                  eq(collectionReferences.iconId, icon.id),
                ),
              );
          if (iconId) await tx.delete(icons).where(filter);
          else
            await tx
              .delete(collections)
              .where(
                and(eq(collections.id, id), eq(collections.ownerId, ownerId)),
              );
        }),
      );
    },
    async addResult(ownerId: string, id: string, conversationId: string) {
      return runDatabase((db) =>
        db.transaction(async (tx) => {
          // Conversation lock excludes active generation and privacy/tracking races.
          const [conversation] = await tx
            .select()
            .from(conversations)
            .where(
              and(
                eq(conversations.id, conversationId),
                eq(conversations.ownerId, ownerId),
              ),
            )
            .for("update");
          if (!conversation)
            throw new ConversationError("Conversation not found.", 404);
          if (conversation.activeRunId)
            throw new ConversationError(
              "Wait for the active generation before adding artwork.",
              409,
            );
          await lockCollection(tx, ownerId, id);
          const [result] = await tx
            .select({ document: svgResults.document })
            .from(svgResults)
            .innerJoin(messages, eq(messages.id, svgResults.assistantMessageId))
            .where(
              and(
                eq(messages.conversationId, conversationId),
                eq(messages.status, "completed"),
              ),
            )
            .orderBy(sql`${messages.position} desc`)
            .limit(1);
          if (!result)
            throw new ConversationError("No completed artwork to add.", 409);
          const added = await insertIcon(tx, ownerId, id, {
            filename: result.document.name,
            source: result.document.source,
          });
          await tx
            .update(conversations)
            .set({ private: true })
            .where(eq(conversations.id, conversationId));
          // Old feedback tokens must not permit private comments to enter Braintrust.
          await tx.execute(
            sql`update messages set details = details - 'feedbackToken' - 'feedbackExpiresAt' where conversation_id = ${conversationId}`,
          );
          return added;
        }),
      );
    },
  };
}
export const collectionStore = createCollectionStore();
