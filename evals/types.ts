import { z } from "zod";
import { generationRequestSchema, type GenerationEvent, type GenerationUsage } from "../lib/workspace/contracts";
import { safeSvgSchema } from "../lib/svg/validate-svg";

export const evalCaseSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/),
  tags: z.array(z.string().trim().min(1).max(80)).max(10),
  input: generationRequestSchema.superRefine((input, context) => {
    if (input.currentSvg && !safeSvgSchema.safeParse(input.currentSvg).success) {
      context.addIssue({ code: "custom", message: "Starting SVG must pass the application's safety validator." });
    }
  }),
  expected: z.object({ requirements: z.array(z.string().trim().min(1).max(500)).min(1).max(20) }).strict(),
}).strict();

export const datasetSchema = z.array(evalCaseSchema).min(1).max(1000).superRefine((cases, context) => {
  const ids = new Set<string>();
  for (const item of cases) {
    if (ids.has(item.id)) context.addIssue({ code: "custom", message: `Duplicate case id: ${item.id}` });
    ids.add(item.id);
  }
});

export type EvalCase = z.infer<typeof evalCaseSchema>;
export type EvalOutput = {
  status: "completed" | "failed";
  source: string | null;
  error: string | null;
  usage: GenerationUsage | null;
  metrics: { durationMs: number; firstPreviewMs: number | null; steps: number; validationAttempts: number };
  // Use public, bounded app events, never private reasoning or raw provider errors.
  events: GenerationEvent[];
};

export type Score = {
  name: string;
  score: number | null; // null = unavailable/needs review, never a successful zero-cost run
  metadata?: Record<string, unknown>;
};

// Scorers are ordinary functions, independent of Braintrust.
export type Scorer = {
  name: string;
  run: (item: EvalCase, output: EvalOutput) => Score | Promise<Score>;
};
