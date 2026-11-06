import { z } from "zod";

export const reviewRubricVersion = "human-visual-quality-v1";

export const visualQualityRubric = [
  {
    anchor: "Broken",
    evidence: "Major defects make the subject or action hard to understand.",
  },
  {
    anchor: "Rough",
    evidence:
      "Recognizable, with conspicuous structural or visual defects that need substantial revision.",
  },
  {
    anchor: "Acceptable",
    evidence: "Coherent and readable, with minor awkward details.",
  },
  {
    anchor: "Polished",
    evidence:
      "Consistent geometry and style, clear silhouettes, and deliberate composition.",
  },
  {
    anchor: "Excellent",
    evidence:
      "Strong composition and execution, with important details clear at normal size.",
  },
] as const;

export const problemTags = [
  "perspective",
  "anatomy",
  "structure",
  "overlaps",
  "composition",
  "style",
  "legibility",
  "other",
] as const;

export const outputHashSchema = z.string().regex(/^[a-f0-9]{64}$/);

export const ratingFieldsSchema = z.strictObject({
  quality: z.number().int().min(1).max(5).nullable(),
  acceptable: z.boolean().nullable(),
  problems: z.array(z.string().trim().min(1).max(100)).max(20),
  notes: z.string().max(5000),
  skipped: z.boolean(),
});

export const saveReviewSchema = z.strictObject({
  id: z.string().min(1).max(200),
  outputSha256: outputHashSchema,
  rating: ratingFieldsSchema.refine(
    ({ skipped, quality, acceptable }) =>
      !skipped || (quality === null && acceptable === null),
  ),
});

export const savedReviewSchema = ratingFieldsSchema.extend({
  reviewer: z.string().max(200).nullable(),
});

export type RatingFields = z.infer<typeof ratingFieldsSchema>;
export type SavedReview = z.infer<typeof savedReviewSchema>;

export const blankRating: RatingFields = {
  quality: null,
  acceptable: null,
  problems: [],
  notes: "",
  skipped: false,
};
