import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq, sql, asc } from "drizzle-orm";
import { SaxesParser } from "saxes";
import { withDatabase } from "../db/client";
import {
  collectionIcons as icons,
  collectionReferences as references,
  conversations,
} from "../db/schema";
import { lockCollection, consumeUsage } from "./store";
import {
  collectionModels,
  collectionProviders,
  type CollectionProviders,
} from "./providers";
import { validateEmbedding } from "./process";
import { ConversationError } from "../conversations/errors";
import { safeSvgSchema } from "../svg/validate-svg";
import type { Retrieval } from "./contracts";

type Candidate = Retrieval["candidates"][number];
// Equal-weight RRF uses rank positions, not incomparable raw scores.
export function fuseRanks(
  semantic: { id: string; score: number }[],
  keyword: string[],
) {
  const merged = new Map<
    string,
    {
      id: string;
      semanticScore: number | null;
      semanticRank: number | null;
      keywordRank: number | null;
      fusedScore: number;
      fusedRank: number;
    }
  >();
  const get = (id: string) => {
    if (!merged.has(id))
      merged.set(id, {
        id,
        semanticScore: null,
        semanticRank: null,
        keywordRank: null,
        fusedScore: 0,
        fusedRank: 0,
      });
    return merged.get(id)!;
  };
  semantic.forEach((row, i) => {
    const item = get(row.id);
    item.semanticScore = row.score;
    item.semanticRank = i + 1;
    item.fusedScore += 1 / (60 + i + 1);
  });
  keyword.forEach((id, i) => {
    const item = get(id);
    item.keywordRank = i + 1;
    item.fusedScore += 1 / (60 + i + 1);
  });
  return [...merged.values()]
    .sort((a, b) => b.fusedScore - a.fusedScore || a.id.localeCompare(b.id))
    .map((row, i) => ({ ...row, fusedRank: i + 1 }));
}
export function selectReferences(
  rows: { id: string; hash: string; source: string }[],
) {
  let characters = 0;
  const selected = [];
  for (const row of rows) {
    const source = safeSvgSchema.parse(row.source).source;
    if (selected.length === 3) break;
    if (characters + source.length > 48000) continue;
    characters += source.length;
    selected.push({
      id: randomUUID(),
      iconId: row.id,
      hash: row.hash,
      source,
      deleted: false,
    });
  }
  return selected;
}
export function observeConventions(sources: string[]) {
  const counts = new Map<string, number>();
  for (const source of sources) {
    const values = new Set<string>();
    const parser = new SaxesParser({ xmlns: true });
    parser.on("opentag", (tag) => {
      for (const name of [
        "viewBox",
        "stroke-width",
        "fill",
        "stroke",
        "stroke-linecap",
        "stroke-linejoin",
      ]) {
        const attr = tag.attributes[name];
        if (attr && attr.value.length <= 100)
          values.add(`${name}=${attr.value}`);
      }
    });
    parser.write(source).close();
    for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts]
    .filter(([, count]) => count >= Math.max(1, Math.ceil(sources.length / 2)))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 10)
    .map(
      ([value, count]) =>
        `${value} (observed in ${count}/${sources.length} searchable icons)`,
    );
}
export const retrievalQuery = (initial: string, latest: string) =>
  initial === latest ? initial : `${initial}\n${latest}`;
export function createCollectionSearch(
  runDatabase = withDatabase,
  providers: CollectionProviders = collectionProviders,
) {
  return async (
    ownerId: string,
    collectionId: string,
    query: string,
    signal: AbortSignal,
    assistantMessageId?: string,
  ): Promise<Retrieval> => {
    const config = collectionModels();
    // Consume before the provider call, so failing searches cannot evade limits.
    await runDatabase((db) =>
      db.transaction(async (tx) => {
        await lockCollection(tx, ownerId, collectionId);
        await consumeUsage(tx, ownerId, "search");
      }),
    );
    const { embeddings } = await providers.embed([query], signal);
    const vector = JSON.stringify(validateEmbedding(embeddings[0]));
    return runDatabase((db) =>
      db.transaction(async (tx) => {
        const collection = await lockCollection(tx, ownerId, collectionId);
        const scope = and(
          eq(icons.ownerId, ownerId),
          eq(icons.collectionId, collectionId),
          eq(icons.status, "ready"),
        );
        const [incompatible] = await tx
          .select({ id: icons.id })
          .from(icons)
          .where(
            and(
              scope,
              sql`(embedding_model is distinct from ${config.embedding} or embedding_dimensions is distinct from 1536)`,
            ),
          )
          .limit(1);
        if (incompatible)
          throw new ConversationError(
            "Embedding configuration changed. Reindex this collection before searching.",
            409,
          );
        const compatible = and(
          scope,
          eq(icons.embeddingModel, config.embedding),
          eq(icons.embeddingDimensions, 1536),
        );
        const distance = sql<number>`${icons.embedding} <=> ${vector}::vector`;
        const text = sql`to_tsvector('simple', ${icons.filename} || ' ' || coalesce(${icons.description}, '') || ' ' || ${icons.tags}::text)`;
        const tsquery = sql`plainto_tsquery('simple', ${query})`;
        const semantic = await tx
          .select({ id: icons.id, score: sql<number>`1 - (${distance})` })
          .from(icons)
          .where(compatible)
          .orderBy(distance, asc(icons.id))
          .limit(10);
        const keyword = await tx
          .select({ id: icons.id })
          .from(icons)
          .where(and(compatible, sql`${text} @@ ${tsquery}`))
          .orderBy(sql`ts_rank_cd(${text}, ${tsquery}) desc`, asc(icons.id))
          .limit(10);
        const fused = fuseRanks(
          semantic,
          keyword.map((row) => row.id),
        );
        const rows = fused.length
          ? await tx
              .select()
              .from(icons)
              .where(
                and(
                  compatible,
                  sql`${icons.id} in (${sql.join(
                    fused.map((row) => sql`${row.id}::uuid`),
                    sql`, `,
                  )})`,
                ),
              )
          : [];
        const byId = new Map(rows.map((row) => [row.id, row]));
        const candidates: Candidate[] = fused.map((rank) => {
          const row = byId.get(rank.id)!;
          return {
            ...rank,
            filename: row.filename,
            description: row.description!,
            hash: row.hash,
          };
        });
        const selected = selectReferences(
          fused.map((rank) => byId.get(rank.id)!),
        );
        const styleSources = await tx
          .select({ source: icons.source })
          .from(icons)
          .where(compatible)
          .orderBy(asc(icons.id))
          .limit(200);
        if (assistantMessageId) {
          const [owner] = await tx
            .select({ id: conversations.id })
            .from(conversations)
            .where(
              and(
                eq(conversations.ownerId, ownerId),
                eq(conversations.activeRunId, assistantMessageId),
                eq(conversations.collectionId, collectionId),
                eq(conversations.private, true),
              ),
            );
          if (!owner)
            throw new ConversationError("Generation is no longer active.", 409);
          for (const ref of selected)
            await tx
              .insert(references)
              .values({
                id: ref.id,
                ownerId,
                assistantMessageId,
                iconId: ref.iconId,
                hash: ref.hash,
                source: ref.source,
              });
        }
        return {
          query,
          collectionId,
          collectionName: collection.name,
          candidates,
          references: selected,
          conventions: observeConventions(
            styleSources.map((row) => safeSvgSchema.parse(row.source).source),
          ),
        };
      }),
    );
  };
}
export const searchCollection = createCollectionSearch();
export { withoutReferenceSources } from "./evidence";
