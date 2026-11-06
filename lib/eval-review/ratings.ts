import { createHash } from "node:crypto";
import { z } from "zod";
import {
  outputHashSchema,
  reviewRubricVersion,
  savedReviewSchema,
  type SavedReview,
} from "./contracts";

const feedbackReviewSchema = savedReviewSchema
  .extend({
    rubricVersion: z.literal(reviewRubricVersion),
    outputSha256: outputHashSchema,
  })
  .strip();
const auditRowSchema = z.object({
  id: z.string(),
  _xact_id: z.string(),
  audit_data: z.object({
    metadata: z.object({ humanReview: feedbackReviewSchema }),
  }),
});
export function latestReviewFeedback(rows: unknown[]) {
  const reviews = new Map<string, z.infer<typeof auditRowSchema>>();
  for (const row of rows) {
    const parsed = auditRowSchema.safeParse(row);
    if (!parsed.success) continue;
    const entry = parsed.data;
    const previous = reviews.get(entry.id);
    if (!previous || entry._xact_id > previous._xact_id)
      reviews.set(entry.id, entry);
  }
  return reviews;
}

export function readHumanReview(
  outputSha256: string,
  feedback?: z.infer<typeof auditRowSchema>,
): SavedReview | null {
  const review = feedback?.audit_data.metadata.humanReview;
  if (!review || review.outputSha256 !== outputSha256) return null;
  const { quality, acceptable, problems, notes, skipped, reviewer } = review;
  return { quality, acceptable, problems, notes, skipped, reviewer };
}

export function outputHash(source: string) {
  return createHash("sha256").update(source).digest("hex");
}

export function encodeHumanReview(
  review: SavedReview,
  outputSha256: string | null,
) {
  return {
    scores: {
      human_visual_quality: review.quality === null ? null : review.quality / 5,
      human_acceptable:
        review.acceptable === null ? null : Number(review.acceptable),
    },
    metadata: {
      humanReview: {
        ...review,
        rubricVersion: reviewRubricVersion,
        outputSha256,
      },
    },
  };
}
