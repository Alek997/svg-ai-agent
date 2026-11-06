import { isDeepStrictEqual } from "node:util";
import { parseDocument } from "yaml";
import { z } from "zod";
import { evalCaseSchema } from "./types";
import {
  outputHashSchema,
  ratingFieldsSchema,
  reviewRubricVersion,
} from "../lib/eval-review/contracts";
import { encodeHumanReview, outputHash } from "../lib/eval-review/ratings";

export { outputHash } from "../lib/eval-review/ratings";

const reviewSchema = ratingFieldsSchema.extend({
  case: z.string(),
  output_sha256: outputHashSchema,
});

export const humanReviewsSchema = z
  .object({
    rubric_version: z.literal(reviewRubricVersion),
    reviewer: z.string().trim().max(200),
    reviews: z.array(reviewSchema).max(1000),
  })
  .strict()
  .superRefine((document, context) => {
    const cases = new Set<string>();
    for (const review of document.reviews) {
      if (cases.has(review.case))
        context.addIssue({
          code: "custom",
          message: `Duplicate review: ${review.case}`,
        });
      cases.add(review.case);
      if (
        review.skipped &&
        (review.quality !== null || review.acceptable !== null)
      )
        context.addIssue({
          code: "custom",
          message: `Skipped review must have null ratings: ${review.case}`,
        });
      if (
        (review.quality !== null || review.acceptable !== null) &&
        !document.reviewer
      )
        context.addIssue({
          code: "custom",
          message: "Set reviewer before syncing ratings.",
        });
    }
  });

export const reviewRunSchema = z.object({
  metadata: z
    .object({ braintrustUpload: z.boolean().optional() })
    .passthrough()
    .optional(),
  summary: z.object({
    projectId: z.string().uuid(),
    experimentId: z.string().uuid(),
    experimentName: z.string().min(1),
    experimentUrl: z.string().url().optional(),
  }),
  results: z
    .array(
      z.object({
        input: evalCaseSchema,
        output: z
          .object({
            status: z.enum(["completed", "failed"]),
            source: z.string().nullable(),
          })
          .nullish(),
      }),
    )
    .max(1000),
});

export function parseHumanReviews(text: string) {
  const document = parseDocument(text, { uniqueKeys: true });
  if (document.errors.length)
    throw new Error("Invalid review YAML; check syntax and duplicate keys.");
  return humanReviewsSchema.parse(document.toJS({ maxAliasCount: 0 }));
}

export function prepareHumanScores(
  run: z.infer<typeof reviewRunSchema>,
  document: z.infer<typeof humanReviewsSchema>,
) {
  const cases = new Map(run.results.map((row) => [row.input.id, row]));
  if (cases.size !== run.results.length)
    throw new Error("Ambiguous run: duplicate case IDs.");
  for (const review of document.reviews) {
    const row = cases.get(review.case);
    if (!row || row.output?.status !== "completed" || !row.output.source)
      throw new Error(`Review has no completed output: ${review.case}`);
    if (outputHash(row.output.source) !== review.output_sha256)
      throw new Error(
        `SVG hash mismatch: ${review.case}. Review the exact output before syncing.`,
      );
  }
  return run.results.map((row) => {
    const review = document.reviews.find((item) => item.case === row.input.id);
    const quality = review && !review.skipped ? review.quality : null;
    const acceptable = review && !review.skipped ? review.acceptable : null;
    return {
      row,
      ...encodeHumanReview(
        {
          reviewer: document.reviewer || null,
          quality,
          acceptable,
          problems: review?.problems ?? [],
          notes: review?.notes ?? "",
          skipped: review?.skipped ?? false,
        },
        row.output?.source ? outputHash(row.output.source) : null,
      ),
    };
  });
}

export function matchHumanScoreRows(
  plan: ReturnType<typeof prepareHumanScores>,
  remoteRows: unknown[],
) {
  const remoteSchema = z.object({
    id: z.string().min(1),
    input: z.unknown(),
    output: z.unknown().optional(),
    span_parents: z.array(z.string()).nullish(),
  });
  const roots = remoteRows.flatMap((row) => {
    const parsed = remoteSchema.safeParse(row);
    return parsed.success && !parsed.data.span_parents?.length
      ? [parsed.data]
      : [];
  });
  return plan.map(({ row, ...update }) => {
    const matches = roots.filter((remote) =>
      isDeepStrictEqual(remote.input, row.input),
    );
    if (matches.length !== 1)
      throw new Error(`Expected one matching Braintrust row: ${row.input.id}`);
    const remoteOutput = z
      .object({ status: z.string(), source: z.string().nullable() })
      .nullish()
      .parse(matches[0].output);
    if (
      !isDeepStrictEqual(
        remoteOutput,
        row.output
          ? { status: row.output.status, source: row.output.source }
          : row.output,
      )
    )
      throw new Error(`Braintrust output differs: ${row.input.id}`);
    return { id: matches[0].id, case: row.input.id, ...update };
  });
}
