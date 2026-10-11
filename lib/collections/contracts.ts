import { z } from "zod";
import { safeSvgSchema } from "../svg/validate-svg";
export const COLLECTION_LIMITS = {
  collections: 5,
  icons: 200,
  fileBytes: 65536,
  batch: 5,
  attempts: 3,
  dailyAnalysis: 200,
  hourlySearch: 120,
} as const;
export const collectionNameSchema = z
  .object({ name: z.string().trim().min(1).max(80) })
  .strict();
export const descriptionSchema = z
  .object({
    description: z.string().trim().min(1).max(1000),
    tags: z.array(z.string().trim().min(1).max(60)).max(12),
  })
  .strict();
export const iconUploadSchema = z
  .object({
    filename: z
      .string()
      .min(1)
      .max(200)
      .refine(
        (v) => v.toLowerCase().endsWith(".svg"),
        "Select standalone .svg files.",
      ),
    source: z
      .string()
      .min(1)
      .max(48000)
      .refine(
        (v) =>
          new TextEncoder().encode(v).length <= COLLECTION_LIMITS.fileBytes,
        "SVG exceeds 64 KB.",
      )
      .transform((v, ctx) => {
        const safe = safeSvgSchema.safeParse(v);
        if (!safe.success) {
          ctx.addIssue({
            code: "custom",
            message: "Unsupported or unsafe SVG.",
          });
          return z.NEVER;
        }
        return safe.data.source;
      }),
  })
  .strict();
export { retrievalSchema, type Retrieval } from "./evidence";
export type CollectionIcon = {
  id: string;
  filename: string;
  source: string;
  hash: string;
  description: string | null;
  tags: string[];
  status: string;
  descriptionAttempts: number;
  embeddingAttempts: number;
  error: string | null;
  claimExpiresAt: string | null;
  embeddingModel: string | null;
  usage: Record<string, unknown>[];
};
export type CollectionSummary = {
  id: string;
  name: string;
  total: number;
  ready: number;
};
