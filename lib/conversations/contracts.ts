import { z } from "zod";
import { MAX_PROMPT_LENGTH, svgDocumentSchema, stepTraceSchema, toolTraceSchema, generationUsageSchema } from "../workspace/contracts";
import { publicIdSchema } from "../svg/public-id";

export const RUN_LEASE_MS = 330_000;
export const MESSAGE_PAGE_SIZE = 10;
export const conversationIdSchema = z.string().uuid();
export const createConversationSchema = z.object({
  requestId: z.string().uuid(),
  content: z.string().trim().min(1).max(MAX_PROMPT_LENGTH),
}).strict();
export const submissionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("message"), conversationId: conversationIdSchema, content: z.string().trim().min(1).max(MAX_PROMPT_LENGTH), requestId: z.string().uuid(), expectedRevision: z.number().int().nonnegative() }).strict(),
  z.object({ kind: z.literal("retry"), conversationId: conversationIdSchema, retryOf: z.string().uuid(), requestId: z.string().uuid(), expectedRevision: z.number().int().nonnegative() }).strict(),
]);
export type Submission = z.infer<typeof submissionSchema>;

export const flowEntrySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("step"), detail: stepTraceSchema }).strict(),
  z.object({ kind: z.literal("tool"), call: toolTraceSchema }).strict(),
  z.object({ kind: z.literal("response"), step: z.number().int().min(1).max(6), text: z.string().max(2000) }).strict(),
  z.object({ kind: z.literal("preview"), characters: z.number().int().nonnegative(), width: z.number().positive(), height: z.number().positive() }).strict(),
  z.object({ kind: z.literal("result"), message: z.string().max(2000), document: svgDocumentSchema }).strict(),
  z.object({ kind: z.literal("error"), message: z.string().max(500) }).strict(),
]);
const storedFlowEntrySchema = z.union([
  flowEntrySchema.options[0], flowEntrySchema.options[1], flowEntrySchema.options[2], flowEntrySchema.options[3], flowEntrySchema.options[5],
  z.object({ kind: z.literal("result"), message: z.string().max(2000), resultId: z.string().uuid() }).strict(),
]);
export const storedDetailsSchema = z.object({
  version: z.literal(1),
  flow: z.array(storedFlowEntrySchema).max(10_000),
  usage: generationUsageSchema.optional(),
  feedbackToken: z.string().max(1000).optional(),
  feedbackExpiresAt: z.number().int().optional(),
  feedbackSaved: z.boolean().optional(),
  feedback: z.object({ rating: z.union([z.literal(0), z.literal(1)]), comment: z.string().max(1000), reason: z.string().max(100).optional() }).strict().optional(),
  retryable: z.boolean().default(true),
}).strict();
export type StoredDetails = z.infer<typeof storedDetailsSchema>;
export const chatMessageSchema = z.object({
  id: z.string().uuid(), position: z.number().int().positive(), role: z.enum(["user", "assistant"]), content: z.string().max(2000),
  excludedFromContext: z.boolean(), flow: z.array(flowEntrySchema).max(10_000),
  runStatus: z.enum(["running", "completed", "error", "interrupted"]), runError: z.string().max(500).optional(),
  steps: z.array(stepTraceSchema).max(6).optional(), tools: z.array(toolTraceSchema).max(100).optional(),
  usage: generationUsageSchema.optional(), feedbackToken: z.string().max(1000).optional(), feedbackExpiresAt: z.number().int().optional(), feedbackSaved: z.boolean().optional(), retryable: z.boolean(),
}).strict();
export const conversationSummarySchema = z.object({
  id: conversationIdSchema, title: z.string().max(100), updatedAt: z.string().datetime(),
}).strict();
export const conversationPageSchema = z.object({
  conversation: conversationSummarySchema.extend({ revision: z.number().int().nonnegative(), activeRunId: z.string().uuid().nullable(), leaseExpiresAt: z.string().datetime().nullable() }),
  messages: z.array(chatMessageSchema).max(MESSAGE_PAGE_SIZE),
  document: svgDocumentSchema.nullable(), olderCursor: z.number().int().positive().nullable(),
  publicId: publicIdSchema.nullable(),
}).strict();
export const conversationListSchema = z.object({ conversations: z.array(conversationSummarySchema.extend({ document: svgDocumentSchema.nullable().optional() })).max(20), nextCursor: z.string().nullable() }).strict();
export type ConversationPage = z.infer<typeof conversationPageSchema>;
