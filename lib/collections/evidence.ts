import { z } from "zod";
export const retrievalSchema = z
  .object({
    query: z.string().max(4001),
    collectionId: z.string().uuid(),
    collectionName: z.string().max(80),
    candidates: z
      .array(
        z
          .object({
            id: z.string().uuid(),
            filename: z.string(),
            description: z.string(),
            semanticScore: z.number().nullable(),
            semanticRank: z.number().int().nullable(),
            keywordRank: z.number().int().nullable(),
            fusedScore: z.number(),
            fusedRank: z.number().int(),
            hash: z.string(),
          })
          .strict(),
      )
      .max(20),
    references: z
      .array(
        z
          .object({
            id: z.string().uuid(),
            iconId: z.string().uuid(),
            hash: z.string(),
            source: z.string().max(48000).nullable(),
            deleted: z.boolean(),
          })
          .strict(),
      )
      .max(3),
    conventions: z.array(z.string().max(200)).max(10),
  })
  .strict();
export type Retrieval = z.infer<typeof retrievalSchema>;

// Persist only IDs/evidence in message JSON; source copies live in the deletable table.
export const withoutReferenceSources = (value: Retrieval): Retrieval => ({
  ...value,
  references: value.references.map((ref) => ({ ...ref, source: null })),
});
