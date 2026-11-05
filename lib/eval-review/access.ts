import "server-only";
import { readPrivateMetadata } from "@/lib/auth/private-metadata";
import { createEvalReview } from "./service";

export async function canReviewEvals(userId: string) {
  const { capabilities } = await readPrivateMetadata(userId);
  return Array.isArray(capabilities) && capabilities.includes("admin-eval");
}

export const evalReview = createEvalReview({
  authorize: canReviewEvals,
  project: process.env.BRAINTRUST_PROJECT?.trim() || "svg-ai-agent",
  apiKey: process.env.BRAINTRUST_API_KEY?.trim(),
});
