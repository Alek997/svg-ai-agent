import "server-only";
import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, lt, or, sql } from "drizzle-orm";
import { z } from "zod";
import { withDatabase } from "../db/client";
import { conversations, messages, svgResults } from "../db/schema";
import { safeSvgSchema } from "../svg/validate-svg";
import { svgDocumentSchema, type GenerationRequest } from "../workspace/contracts";
import type { ChatMessage, SvgDocument } from "../workspace/types";
import type { FeedbackRequest } from "../workspace/feedback";
import { verifyFeedbackToken } from "../ai/feedback-token";
import { conversationIdSchema, chatMessageSchema, storedDetailsSchema, RUN_LEASE_MS, MESSAGE_PAGE_SIZE, type StoredDetails, type Submission, type ConversationPage } from "./contracts";
import { finishDetails, selectContext } from "./state";

type Database = Parameters<Parameters<typeof withDatabase>[0]>[0];
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type MessageRow = typeof messages.$inferSelect;
type ConversationRow = typeof conversations.$inferSelect;
const blankDetails = (): StoredDetails => ({ version: 1, flow: [], retryable: true });
export class ConversationError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}
export type StartedRun = {
  replayed: boolean; conversationId: string; userMessageId: string; assistantMessageId: string; revision: number;
  message: ChatMessage; document: SvgDocument | null; input: GenerationRequest;
};

function safeDocument(value: unknown): SvgDocument {
  const document = svgDocumentSchema.parse(value);
  return { ...document, ...safeSvgSchema.parse(document.source) };
}
function hydrate(row: MessageRow, result?: typeof svgResults.$inferSelect | null): ChatMessage {
  const details = storedDetailsSchema.parse(row.details);
  const flow = details.flow.map(entry => {
    if (entry.kind !== "result") return entry;
    if (!result || result.id !== entry.resultId) throw new Error("Missing saved artwork.");
    return { kind: "result" as const, message: entry.message, document: safeDocument(result.document) };
  });
  const hydrated: ChatMessage = { id: row.id, position: row.position, role: row.role, content: row.content,
    excludedFromContext: row.excludedFromContext, flow, runStatus: row.status,
    ...(row.error ? { runError: row.error } : {}), usage: details.usage,
    feedbackToken: details.feedbackToken, feedbackExpiresAt: details.feedbackExpiresAt,
    feedbackSaved: details.feedbackSaved, retryable: details.retryable,
  };
  return row.status === "running" ? hydrated : finishDetails(hydrated);
}
function summary(row: ConversationRow) { return { id: row.id, title: row.title, updatedAt: row.updatedAt.toISOString() }; }
const cursorSchema = z.object({ updatedAt: z.string().datetime(), id: z.string().uuid() }).strict();

async function owned(tx: Transaction, ownerId: string, id: string) {
  if (!conversationIdSchema.safeParse(id).success) throw new ConversationError("Conversation not found.", 404);
  const [row] = await tx.select().from(conversations).where(and(eq(conversations.id, id), eq(conversations.ownerId, ownerId))).for("update");
  if (!row) throw new ConversationError("Conversation not found.", 404);
  if (row.activeRunId && row.leaseExpiresAt && row.leaseExpiresAt.getTime() <= Date.now()) {
    const [run] = await tx.select().from(messages).where(eq(messages.id, row.activeRunId));
    if (run?.status === "running") {
      const error = "Generation was interrupted. Please retry.";
      const details = storedDetailsSchema.parse(run.details);
      await tx.update(messages).set({ status: "interrupted", error, details: { ...details, flow: [...details.flow, { kind: "error", message: error }] } }).where(eq(messages.id, run.id));
    }
    const [recovered] = await tx.update(conversations).set({ activeRunId: null, leaseExpiresAt: null, revision: row.revision + 1, updatedAt: new Date() }).where(eq(conversations.id, id)).returning();
    return recovered;
  }
  return row;
}

// Database injection allows real PostgreSQL transaction tests without Neon credentials.
export function createConversationStore(runDatabase: typeof withDatabase = withDatabase) {
  return {
    async create(ownerId: string, requestId: string, content: string) {
      return runDatabase(async db => {
        const [created] = await db.insert(conversations).values({ id: randomUUID(), ownerId, creationRequestId: requestId, title: content.slice(0, 100) }).onConflictDoNothing().returning();
        if (created) return { ...summary(created), revision: created.revision };
        const [existing] = await db.select().from(conversations).where(and(eq(conversations.ownerId, ownerId), eq(conversations.creationRequestId, requestId)));
        if (!existing || existing.title !== content.slice(0, 100)) throw new ConversationError("Creation request ID was already used.", 409);
        return { ...summary(existing), revision: existing.revision };
      });
    },
    async list(ownerId: string, cursor?: string, includeArtwork = false) {
      let before: z.infer<typeof cursorSchema> | undefined;
      if (cursor) {
        try { before = cursorSchema.parse(JSON.parse(Buffer.from(cursor, "base64url").toString())); }
        catch { throw new ConversationError("Invalid history cursor.", 400); }
      }
      return runDatabase(async db => {
        const rows = await db.select().from(conversations).where(and(eq(conversations.ownerId, ownerId), before ? or(lt(conversations.updatedAt, new Date(before.updatedAt)), and(eq(conversations.updatedAt, new Date(before.updatedAt)), lt(conversations.id, before.id))) : undefined)).orderBy(desc(conversations.updatedAt), desc(conversations.id)).limit(21);
        const selected = rows.slice(0, 20);
        // One additional query for the whole page, rather than one per card.
        const artwork = includeArtwork && selected.length ? await db.selectDistinctOn([messages.conversationId], { conversationId: messages.conversationId, document: svgResults.document }).from(svgResults).innerJoin(messages, eq(messages.id, svgResults.assistantMessageId)).where(and(inArray(messages.conversationId, selected.map(row => row.id)), eq(messages.status, "completed"))).orderBy(messages.conversationId, desc(messages.position)) : [];
        const documents = new Map(artwork.map(row => [row.conversationId, safeDocument(row.document)]));
        const page = selected.map(row => ({ ...summary(row), ...(includeArtwork ? { document: documents.get(row.id) ?? null } : {}) }));
        const last = page.at(-1);
        return { conversations: page, nextCursor: rows.length > 20 && last ? Buffer.from(JSON.stringify({ updatedAt: last.updatedAt, id: last.id })).toString("base64url") : null };
      });
    },
    async page(ownerId: string, id: string, before?: number): Promise<ConversationPage> {
      return runDatabase(db => db.transaction(async tx => {
        const conversation = await owned(tx, ownerId, id);
        const rows = await tx.select({ message: messages, result: svgResults }).from(messages).leftJoin(svgResults, eq(svgResults.assistantMessageId, messages.id)).where(and(eq(messages.conversationId, id), before ? lt(messages.position, before) : undefined)).orderBy(desc(messages.position)).limit(MESSAGE_PAGE_SIZE + 1);
        const [latest] = await tx.select({ document: svgResults.document }).from(svgResults).innerJoin(messages, eq(messages.id, svgResults.assistantMessageId)).where(and(eq(messages.conversationId, id), eq(messages.status, "completed"))).orderBy(desc(messages.position)).limit(1);
        const selected = rows.slice(0, MESSAGE_PAGE_SIZE).reverse();
        return { conversation: { ...summary(conversation), revision: conversation.revision, activeRunId: conversation.activeRunId, leaseExpiresAt: conversation.leaseExpiresAt?.toISOString() ?? null },
          messages: selected.map(row => chatMessageSchema.parse(hydrate(row.message, row.result))), document: latest ? safeDocument(latest.document) : null,
          olderCursor: rows.length > MESSAGE_PAGE_SIZE ? selected[0].message.position : null };
      }));
    },
    async begin(ownerId: string, submission: Submission): Promise<StartedRun> {
      return runDatabase(db => db.transaction(async tx => {
        const conversation = await owned(tx, ownerId, submission.conversationId);
        const [duplicate] = await tx.select().from(messages).where(and(eq(messages.conversationId, conversation.id), eq(messages.requestId, submission.requestId)));
        if (!duplicate && (conversation.activeRunId || conversation.revision !== submission.expectedRevision)) throw new ConversationError("This conversation changed or has an active generation. Reopen it before continuing.", 409);
        let user: MessageRow;
        if (duplicate) {
          const [original] = await tx.select().from(messages).where(and(eq(messages.id, duplicate.userMessageId!), eq(messages.conversationId, conversation.id), eq(messages.role, "user")));
          if (!original || (submission.kind === "message" ? duplicate.retryOf !== null || original.content !== submission.content : duplicate.retryOf !== submission.retryOf)) throw new ConversationError("Request ID was already used for another message.", 409);
          user = original;
        } else if (submission.kind === "retry") {
          const [target] = await tx.select().from(messages).where(and(eq(messages.id, submission.retryOf), eq(messages.conversationId, conversation.id)));
          if (!target || target.role !== "assistant" || !["error", "interrupted"].includes(target.status) || !storedDetailsSchema.parse(target.details).retryable || target.position !== conversation.nextPosition - 1) throw new ConversationError("Only the latest failed generation can be retried.", 409);
          const [original] = await tx.select().from(messages).where(and(eq(messages.id, target.userMessageId!), eq(messages.conversationId, conversation.id)));
          if (!original || original.excludedFromContext) throw new ConversationError("This prompt cannot be retried.", 409);
          user = original;
        } else {
          [user] = await tx.insert(messages).values({ id: randomUUID(), conversationId: conversation.id, position: conversation.nextPosition, role: "user", content: submission.content, status: "completed", details: blankDetails() }).returning();
        }
        const [latest] = await tx.select({ document: svgResults.document }).from(svgResults).innerJoin(messages, eq(messages.id, svgResults.assistantMessageId)).where(and(eq(messages.conversationId, conversation.id), eq(messages.status, "completed"))).orderBy(desc(messages.position)).limit(1);
        const document = latest ? safeDocument(latest.document) : null;
        const history = await tx.select({ role: messages.role, content: messages.content, status: messages.status }).from(messages).where(and(eq(messages.conversationId, conversation.id), lt(messages.position, user.position), eq(messages.excludedFromContext, false))).orderBy(desc(messages.position)).limit(40);
        const input: GenerationRequest = { conversationId: conversation.id, messages: selectContext(history.reverse().map(row => ({ role: row.role, content: row.content, runStatus: row.status })), user.content), ...(document ? { currentSvg: document.source } : {}) };
        let assistant = duplicate;
        let revision = conversation.revision;
        if (!duplicate) {
          const position = conversation.nextPosition + (submission.kind === "message" ? 1 : 0);
          [assistant] = await tx.insert(messages).values({ id: randomUUID(), conversationId: conversation.id, position, role: "assistant", status: "running", requestId: submission.requestId, userMessageId: user.id, retryOf: submission.kind === "retry" ? submission.retryOf : null, details: blankDetails() }).returning();
          revision++;
          await tx.update(conversations).set({ revision, nextPosition: position + 1, activeRunId: assistant.id, leaseExpiresAt: new Date(Date.now() + RUN_LEASE_MS), updatedAt: new Date() }).where(eq(conversations.id, conversation.id));
        }
        const [result] = duplicate ? await tx.select().from(svgResults).where(eq(svgResults.assistantMessageId, assistant.id)) : [];
        return { replayed: !!duplicate, conversationId: conversation.id, userMessageId: user.id, assistantMessageId: assistant.id, revision, message: hydrate(assistant, result), document: result ? safeDocument(result.document) : document, input };
      }));
    },
    async save(ownerId: string, run: StartedRun, message: ChatMessage, terminal: boolean, document?: SvgDocument, excludeUser = false) {
      await runDatabase(db => db.transaction(async tx => {
        const conversation = await owned(tx, ownerId, run.conversationId);
        if (conversation.activeRunId !== run.assistantMessageId) throw new ConversationError("Generation was interrupted or superseded. Reopen this conversation.", 409);
        let resultId: string | undefined;
        if (document) {
          resultId = randomUUID();
          await tx.insert(svgResults).values({ id: resultId, assistantMessageId: run.assistantMessageId, document: safeDocument(document) });
        }
        const details = storedDetailsSchema.parse({ version: 1, flow: (message.flow ?? []).map(entry => entry.kind === "result" ? { kind: "result", message: entry.message, resultId } : entry), usage: message.usage,
          feedbackToken: message.feedbackToken, feedbackExpiresAt: message.feedbackExpiresAt, feedbackSaved: message.feedbackSaved, retryable: message.retryable ?? true });
        await tx.update(messages).set({ content: message.content, status: message.runStatus ?? "running", error: message.runError ?? null, details }).where(and(eq(messages.id, run.assistantMessageId), eq(messages.conversationId, run.conversationId)));
        if (excludeUser) await tx.update(messages).set({ excludedFromContext: true }).where(eq(messages.id, run.userMessageId));
        await tx.update(conversations).set({ updatedAt: new Date(), ...(terminal ? { activeRunId: null, leaseExpiresAt: null } : {}) }).where(eq(conversations.id, conversation.id));
      }));
    },
    async checkFeedback(ownerId: string, token: string) {
      return runDatabase(async db => {
        const [found] = await db.select({ id: messages.id }).from(messages).innerJoin(conversations, eq(conversations.id, messages.conversationId)).where(and(eq(conversations.ownerId, ownerId), eq(messages.status, "completed"), sqlToken(token))).limit(1);
        if (!found || !process.env.BRAINTRUST_FEEDBACK_SECRET || !verifyFeedbackToken(token, ownerId, process.env.BRAINTRUST_FEEDBACK_SECRET)) throw new ConversationError("Feedback permission expired or was not found.", 403);
      });
    },
    async saveFeedback(ownerId: string, token: string, feedback: FeedbackRequest) {
      await runDatabase(db => db.transaction(async tx => {
        // JSONB token lookup is indexed below only if feedback volume warrants it.
        const candidates = await tx.select({ message: messages }).from(messages).innerJoin(conversations, eq(conversations.id, messages.conversationId)).where(and(eq(conversations.ownerId, ownerId), eq(messages.status, "completed"), sqlToken(token))).for("update", { of: messages });
        const found = candidates[0]?.message;
        if (!found || !process.env.BRAINTRUST_FEEDBACK_SECRET || !verifyFeedbackToken(token, ownerId, process.env.BRAINTRUST_FEEDBACK_SECRET)) throw new ConversationError("Feedback permission expired or was not found.", 403);
        const details = storedDetailsSchema.parse(found.details);
        await tx.update(messages).set({ details: { ...details, feedbackSaved: true, feedback: { rating: feedback.rating, comment: feedback.comment, ...(feedback.reason ? { reason: feedback.reason } : {}) } } }).where(eq(messages.id, found.id));
      }));
    },
  };
}
function sqlToken(token: string) { return sql`${messages.details}->>'feedbackToken' = ${token}`; }
export const conversationStore = createConversationStore();
