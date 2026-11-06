"use server";

import { auth } from "@clerk/nextjs/server";
import { evalReview } from "@/lib/eval-review/access";
import { EvalReviewError } from "@/lib/eval-review/service";

export async function saveEvalReview(
  runId: string,
  id: string,
  outputSha256: string,
  rating: unknown,
) {
  try {
    const { userId } = await auth();
    return {
      review: await evalReview.saveReview(userId, runId, {
        id,
        outputSha256,
        rating,
      }),
    };
  } catch (error) {
    return {
      error:
        error instanceof EvalReviewError
          ? error.message
          : "Could not save the review. Try again.",
    };
  }
}
