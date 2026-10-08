import { z } from "zod";

export const MAX_PROMPT_LENGTH = 2000;
export const MAX_SVG_LENGTH = 48_000;
export const MAX_REQUEST_BYTES = 96_000;
export const MAX_RESPONSE_BYTES = 1_500_000;

export const messageSchema = z
  .object({
    role: z.enum(["user", "assistant"]),
    content: z.string().trim().min(1).max(MAX_PROMPT_LENGTH),
  })
  .strict();

export const generationRequestSchema = z
  .object({
    messages: z.array(messageSchema).min(1).max(20),
    currentSvg: z.string().min(1).max(MAX_SVG_LENGTH).optional(),
  })
  .strict()
  .superRefine(({ messages }, context) => {
    if (messages.at(-1)?.role !== "user") {
      context.addIssue({
        code: "custom",
        message: "The last message must be from the user.",
      });
    }
    if (
      messages.reduce((total, message) => total + message.content.length, 0) >
      16_000
    ) {
      context.addIssue({
        code: "custom",
        message: "Conversation is too long. Start a new conversation.",
      });
    }
  });

export const svgDocumentSchema = z
  .object({
    name: z.string().regex(/^[a-z0-9][a-z0-9-]{0,59}\.svg$/),
    description: z.string().trim().min(1).max(1000),
    source: z.string().min(1).max(MAX_SVG_LENGTH),
    width: z.number().positive().max(4096),
    height: z.number().positive().max(4096),
  })
  .strict();

export const generationUsageSchema = z.object({
  model: z.string().min(1).max(200),
  inputTokens: z.number().int().nonnegative().nullable(),
  outputTokens: z.number().int().nonnegative().nullable(),
  cachedInputTokens: z.number().int().nonnegative().nullable(),
  totalTokens: z.number().int().nonnegative().nullable(),
}).strict();

export type GenerationUsage = z.infer<typeof generationUsageSchema>;

export const previewSvgSchema = svgDocumentSchema.pick({ source: true, width: true, height: true });

export const searchInputSchema = z.object({
  query: z.string().trim().min(1).max(400),
  timeRange: z.enum(["day", "week", "month", "year"]).optional(),
}).strict();

export const searchSourceSchema = z.object({
  title: z.string().min(1).max(200),
  url: z.string().url().max(2000).refine(value => {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password;
  }, "Source must be an HTTP(S) URL without credentials."),
  content: z.string().max(1500),
}).strict();

export const searchOutputSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), query: z.string().max(400), results: z.array(searchSourceSchema).max(5) }).strict(),
  z.object({ ok: z.literal(false), error: z.string().max(500) }).strict(),
]);

// Only server-owned tools' bounded inputs/results cross the browser boundary.
export const toolTraceSchema = z.object({
  id: z.string().min(1).max(200),
  name: z.enum(["querySvg", "validateSvg", "webSearch"]),
  step: z.number().int().min(1).max(6),
  status: z.enum(["pending", "running", "completed", "error"]),
  input: z.union([z.object({ svg: z.string().max(MAX_SVG_LENGTH).optional() }).strict(), searchInputSchema]).optional(),
  output: z.union([
    searchOutputSchema,
    z.object({ source: z.string().max(MAX_SVG_LENGTH).nullable(), version: z.number().int().nonnegative() }).strict(),
    z.object({ valid: z.literal(true), version: z.number().int().nonnegative(), width: z.number().positive(), height: z.number().positive() }).strict(),
    z.object({ valid: z.literal(false), error: z.string().max(1000) }).strict(),
  ]).optional(),
  error: z.string().max(500).optional(),
}).strict();
export type ToolTrace = z.infer<typeof toolTraceSchema>;

export const stepTraceSchema = z.object({
  step: z.number().int().min(1).max(6),
  status: z.enum(["running", "completed", "interrupted"]),
  description: z.string().min(1).max(2000),
}).strict();
export type StepTrace = z.infer<typeof stepTraceSchema>;

export const generationEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("response"), step: z.number().int().min(1).max(6), text: z.string().max(2000) }).strict(),
  z.object({ type: z.literal("step"), detail: stepTraceSchema }).strict(),
  z.object({ type: z.literal("tool"), call: toolTraceSchema }).strict(),
  z.object({ type: z.literal("preview"), svg: previewSvgSchema }).strict(),
  z.object({
    type: z.literal("activity"),
    step: z.number().int().min(1).max(6),
    action: z.enum(["working", "querySvg", "validateSvg", "webSearch"]),
  }).strict(),
  z
    .object({
      type: z.literal("progress"),
      characters: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      type: z.literal("result"),
      message: z.string().trim().min(1).max(2000),
      document: svgDocumentSchema,
      usage: generationUsageSchema,
    })
    .strict(),
  z
    .object({ type: z.literal("error"), message: z.string().min(1).max(500) })
    .strict(),
]);

export type GenerationRequest = z.infer<typeof generationRequestSchema>;
export type GenerationEvent = z.infer<typeof generationEventSchema>;
