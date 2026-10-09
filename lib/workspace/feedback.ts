import { z } from "zod";

export const feedbackReasons = [
  "Didn't match my prompt",
  "Missing details",
  "Looks wrong",
  "Edit changed too much",
] as const;

export const feedbackRequestSchema = z.object({
  token: z.string().min(1).max(1000),
  rating: z.union([z.literal(0), z.literal(1)]),
  reason: z.enum(feedbackReasons).optional(),
  comment: z.string().trim().max(1000).default(""),
}).strict().refine(value => value.rating === 0 || !value.reason, "Reasons apply to negative feedback.");

export type FeedbackRequest = z.infer<typeof feedbackRequestSchema>;
