import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq, sql, asc } from "drizzle-orm";
import { withDatabase } from "../db/client";
import { collectionIcons as icons } from "../db/schema";
import { lockCollection, consumeUsage } from "./store";
import {
  collectionModels,
  collectionProviders,
  type CollectionProviders,
} from "./providers";
import { renderSvg } from "../svg/render-svg";
import { descriptionSchema, COLLECTION_LIMITS as limits } from "./contracts";
export function validateEmbedding(vector: number[]) {
  if (
    vector.length !== 1536 ||
    vector.some((v) => !Number.isFinite(v)) ||
    !vector.some((v) => v !== 0)
  )
    throw new Error("Invalid embedding dimensions or values.");
  return vector;
}
export const embeddingText = (icon: {
  filename: string;
  description: string | null;
  tags: string[];
}) => [icon.filename, icon.description, ...icon.tags].join("\n");
export function createCollectionProcessor(
  runDatabase = withDatabase,
  providers: CollectionProviders = collectionProviders,
  render = renderSvg,
) {
  return async (ownerId: string, collectionId: string, signal: AbortSignal) => {
    signal.throwIfAborted();
    const claimId = randomUUID();
    const config = collectionModels();
    const claimed = await runDatabase((db) =>
      db.transaction(async (tx) => {
        await lockCollection(tx, ownerId, collectionId);
        // An expired in-flight call might have been billed. Explicit retry avoids
        // silently repeating it; completed descriptions remain resumable.
        await tx
          .update(icons)
          .set({
            status: sql`case when description is null then 'description_error' else 'embedding_error' end`,
            error: "Processing was interrupted. Retry this stage explicitly.",
            claimId: null,
            claimExpiresAt: null,
          })
          .where(
            and(
              eq(icons.ownerId, ownerId),
              eq(icons.collectionId, collectionId),
              sql`claim_expires_at <= now()`,
            ),
          );
        const rows = await tx
          .select()
          .from(icons)
          .where(
            and(
              eq(icons.ownerId, ownerId),
              eq(icons.collectionId, collectionId),
              sql`claim_id is null`,
              sql`((status = 'pending' and description_attempts < 3) or (status = 'described' and embedding_attempts < 3))`,
            ),
          )
          .orderBy(asc(icons.createdAt), asc(icons.id))
          .limit(limits.batch)
          .for("update");
        const visionCount = rows.filter((row) => !row.description).length;
        if (visionCount)
          await consumeUsage(tx, ownerId, "analysis", visionCount);
        for (const row of rows)
          await tx
            .update(icons)
            .set({
              claimId,
              claimExpiresAt: new Date(Date.now() + 240_000),
              ...(row.description
                ? { embeddingAttempts: row.embeddingAttempts + 1 }
                : { descriptionAttempts: row.descriptionAttempts + 1 }),
            })
            .where(eq(icons.id, row.id));
        return rows;
      }),
    );
    const guard = (id: string) =>
      and(
        eq(icons.id, id),
        eq(icons.ownerId, ownerId),
        eq(icons.collectionId, collectionId),
        eq(icons.claimId, claimId),
        sql`claim_expires_at > now()`,
      );
    const fail = async (id: string, stage: "description" | "embedding") =>
      runDatabase((db) =>
        db
          .update(icons)
          .set({
            status: `${stage}_error`,
            error: `${stage === "description" ? "Description" : "Embedding"} failed or was interrupted. Retry this stage (maximum three attempts).`,
            claimId: null,
            claimExpiresAt: null,
          })
          .where(guard(id)),
      );
    const toEmbed: typeof claimed = [];
    let cursor = 0;
    await Promise.all(
      [0, 1].map(async () => {
        while (cursor < claimed.length) {
          const row = claimed[cursor++];
          if (row.description) {
            toEmbed.push(row);
            continue;
          }
          try {
            signal.throwIfAborted();
            const described = await providers.describe(
              await render(row.source, 256),
              signal,
            );
            const result = descriptionSchema.parse({
              description: described.description,
              tags: described.tags,
            });
            const saved = await runDatabase((db) =>
              db
                .update(icons)
                .set({
                  ...result,
                  status: "described",
                  descriptionModel: config.description,
                  version: config.version,
                  embeddingAttempts: row.embeddingAttempts + 1,
                  usage: sql`${icons.usage} || ${JSON.stringify([{ stage: "description", ...described.usage }])}::jsonb`,
                })
                .where(guard(row.id))
                .returning(),
            );
            if (saved.length) toEmbed.push(saved[0]);
          } catch {
            await fail(row.id, "description");
          }
        }
      }),
    );
    if (toEmbed.length) {
      try {
        signal.throwIfAborted();
        const embedded = await providers.embed(
          toEmbed.map(embeddingText),
          signal,
        );
        if (embedded.embeddings.length !== toEmbed.length)
          throw new Error("Incomplete embeddings.");
        embedded.embeddings.forEach(validateEmbedding);
        for (let i = 0; i < toEmbed.length; i++)
          await runDatabase((db) =>
            db
              .update(icons)
              .set({
                embedding: embedded.embeddings[i],
                embeddingModel: config.embedding,
                embeddingDimensions: 1536,
                status: "ready",
                claimId: null,
                claimExpiresAt: null,
                error: null,
                usage: sql`${icons.usage} || ${JSON.stringify([{ stage: "embedding", ...embedded.usage, batchSize: toEmbed.length, allocatedTokens: embedded.usage.tokens / toEmbed.length }])}::jsonb`,
              })
              .where(guard(toEmbed[i].id)),
          );
      } catch {
        for (const row of toEmbed) await fail(row.id, "embedding");
      }
    }
    return { processed: claimed.length };
  };
}
export const processCollection = createCollectionProcessor();
