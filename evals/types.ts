import { z } from "zod";
import {
  generationRequestSchema,
  type GenerationEvent,
  type GenerationUsage,
} from "../lib/workspace/contracts";
import { safeSvgSchema } from "../lib/svg/validate-svg";

const renderCheckSchema = z
  .object({
    kind: z.enum(["preserve-region", "color-region", "transparent-region"]),
    region: z
      .object({
        x: z.number().min(0).max(1),
        y: z.number().min(0).max(1),
        width: z.number().positive().max(1),
        height: z.number().positive().max(1),
      })
      .strict()
      .superRefine((region, context) => {
        if (region.x + region.width > 1 || region.y + region.height > 1)
          context.addIssue({
            code: "custom",
            message:
              "Render check region must fit inside the normalized canvas.",
          });
      }),
    color: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .optional(),
    critical: z.boolean().default(false),
  })
  .strict()
  .superRefine((check, context) => {
    if (check.kind === "color-region" && !check.color)
      context.addIssue({
        code: "custom",
        message: "Color-region checks require a target color.",
      });
  });

const evalCaseSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,79}$/),
    tags: z.array(z.string().trim().min(1).max(80)).max(10),
    mode: z.enum(["drawing", "policy"]).default("drawing"),
    category: z
      .enum(["drawing_edit", "policy_ambiguity", "injection_tool"])
      .default("drawing_edit"),
    family: z.string().trim().min(1).max(80).default("legacy-regression"),
    input: generationRequestSchema.superRefine((input, context) => {
      if (
        input.currentSvg &&
        !safeSvgSchema.safeParse(input.currentSvg).success
      ) {
        context.addIssue({
          code: "custom",
          message: "Starting SVG must pass the application's safety validator.",
        });
      }
    }),
    expected: z
      .object({
        requirements: z.array(z.string().trim().min(1).max(500)).min(1).max(20),
        target: z
          .enum(["generate", "reject", "clarify", "conversation"])
          .default("generate"),
        critical: z
          .array(z.string().trim().min(1).max(500))
          .max(20)
          .default([]),
        holdout: z.boolean().default(false),
        fixture: z
          .object({
            searchResults: z
              .array(
                z.object({
                  title: z.string(),
                  url: z.string(),
                  content: z.string(),
                }),
              )
              .optional(),
            retrievalText: z.string().max(4000).optional(),
          })
          .strict()
          .optional(),
        renderChecks: z.array(renderCheckSchema).max(20).default([]),
        requiredTools: z
          .array(z.enum(["querySvg", "validateSvg", "webSearch"]))
          .default([]),
        forbiddenTools: z
          .array(z.enum(["querySvg", "validateSvg", "webSearch"]))
          .default([]),
        forbiddenSvgText: z
          .array(z.string().trim().min(1).max(500))
          .max(20)
          .default([]),
        forbiddenMessageText: z
          .array(z.string().trim().min(1).max(500))
          .max(20)
          .default([]),
      })
      .strict(),
  })
  .strict()
  .superRefine((item, context) => {
    if (
      item.expected.renderChecks.some(
        (check) => check.kind === "preserve-region",
      ) &&
      !item.input.currentSvg
    )
      context.addIssue({
        code: "custom",
        message: "Preserve-region checks require a starting SVG.",
      });
    const requirements = new Set(item.expected.requirements);
    if (
      item.expected.critical.some(
        (requirement) => !requirements.has(requirement),
      )
    )
      context.addIssue({
        code: "custom",
        message:
          "Critical requirements must also appear in the visible requirements checklist.",
      });
    if (
      item.expected.requiredTools.some((tool) =>
        item.expected.forbiddenTools.includes(tool),
      )
    )
      context.addIssue({
        code: "custom",
        message: "A tool cannot be both required and forbidden.",
      });
    if (item.mode === "drawing" && item.expected.target !== "generate")
      context.addIssue({
        code: "custom",
        message: "Drawing mode cases must expect generated artwork.",
      });
    if (item.category === "policy_ambiguity" && item.mode !== "policy")
      context.addIssue({
        code: "custom",
        message: "Policy/ambiguity cases must exercise production policy.",
      });
    if (item.category !== "policy_ambiguity" && item.mode !== "drawing")
      context.addIssue({
        code: "custom",
        message: "Drawing and injection cases use direct drawing mode.",
      });
  });

export const datasetSchema = z
  .array(evalCaseSchema)
  .min(1)
  .max(1000)
  .superRefine((cases, context) => {
    const ids = new Set<string>();
    const holdoutByFamily = new Map<string, boolean>();
    for (const item of cases) {
      if (ids.has(item.id))
        context.addIssue({
          code: "custom",
          message: `Duplicate case id: ${item.id}`,
        });
      ids.add(item.id);
      const family = `${item.category}:${item.family}`;
      const holdout = item.expected.holdout;
      if (
        holdoutByFamily.has(family) &&
        holdoutByFamily.get(family) !== holdout
      )
        context.addIssue({
          code: "custom",
          message: `Scenario family ${item.family} must stay wholly in one split.`,
        });
      holdoutByFamily.set(family, holdout);
    }
  });

export type EvalCase = z.infer<typeof evalCaseSchema>;
export type EvalOutput = {
  status: "completed" | "failed" | "rejected" | "clarified" | "conversation";
  policy:
    | "passed"
    | "rejected"
    | "clarified"
    | "conversation"
    | "not_applicable"
    | "unavailable";
  source: string | null;
  message: string | null;
  error: string | null;
  usage: GenerationUsage | null;
  metrics: {
    durationMs: number;
    firstPreviewMs: number | null;
    steps: number;
    validationAttempts: number;
  };
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

export const savedReviewResultSchema = z.object({
  input: evalCaseSchema,
  output: z
    .object({
      status: z.enum([
        "completed",
        "failed",
        "rejected",
        "clarified",
        "conversation",
      ]),
      source: z.string().nullable(),
    })
    .nullish(),
});
