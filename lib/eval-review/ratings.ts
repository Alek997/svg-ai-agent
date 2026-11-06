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
const reviewAuditEntrySchema = z.object({
  _xact_id: z.string(),
  metadata: z.object({ humanReview: feedbackReviewSchema }),
});
export function readHumanReview(
  outputSha256: string,
  history: unknown,
): SavedReview | null {
  if (!Array.isArray(history)) return null;
  let latest: z.infer<typeof reviewAuditEntrySchema> | undefined;
  for (const entry of history) {
    const parsed = reviewAuditEntrySchema.safeParse(entry);
    if (!parsed.success) continue;
    const candidate = parsed.data;
    if (
      candidate.metadata.humanReview.outputSha256 === outputSha256 &&
      (!latest || candidate._xact_id > latest._xact_id)
    )
      latest = candidate;
  }
  const review = latest?.metadata.humanReview;
  if (!review) return null;
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
