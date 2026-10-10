import assert from "node:assert/strict";
import { test, before, after, beforeEach } from "node:test";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import { createConversationStore, ConversationError } from "../../lib/conversations/store";
import type { withDatabase } from "../../lib/db/client";
import { conversations, messages, svgResults } from "../../lib/db/schema";
import { applyEvent } from "../../lib/conversations/state";
import { conversationPageSchema, type Submission } from "../../lib/conversations/contracts";
import { createFeedbackToken } from "../../lib/ai/feedback-token";

// This suite intentionally requires a disposable database; it truncates its tables.
const connectionString = process.env.TEST_DATABASE_URL;
if (!connectionString || !new URL(connectionString).pathname.startsWith("/svg_conversations_test")) throw new Error("Set TEST_DATABASE_URL to a disposable svg_conversations_test* database.");
const pool = new Pool({ connectionString });
const db = drizzle(pool);
const runDatabase: typeof withDatabase = async action => action(db as unknown as Parameters<Parameters<typeof withDatabase>[0]>[0]);
const store = createConversationStore(runDatabase);
const doc = { name: "circle.svg", description: "Circle", source: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="30"/></svg>', width: 100, height: 100 };
const usage = { model: "mock", inputTokens: 10, outputTokens: 20, cachedInputTokens: 0, totalTokens: 30 };
before(async () => {
  await pool.query("DROP TABLE IF EXISTS svg_results, messages, conversations CASCADE");
  for (const name of (await readdir("drizzle")).filter(name => name.endsWith(".sql")).sort()) await pool.query(await readFile(`drizzle/${name}`, "utf8"));
});
beforeEach(async () => { await pool.query("TRUNCATE svg_results, messages, conversations CASCADE"); });
after(async () => { await pool.end(); });
async function create(owner = "user_a") { return store.create(owner, randomUUID(), "Draw a circle"); }
function submit(conversationId: string, expectedRevision: number, content = "Draw a circle"): Submission { return { kind: "message", conversationId, content, expectedRevision, requestId: randomUUID() }; }
async function complete(run: Awaited<ReturnType<typeof store.begin>>, owner = "user_a") {
  const message = applyEvent(run.message, { type: "result", message: "Created a circle", document: doc, usage });
  await store.save(owner, run, message, true, doc);
}
const notFound = (error: unknown) => error instanceof ConversationError && error.status === 404;

test("owner isolation applies to lists, reads, claims and writes", async () => {
  const conversation = await create();
  assert.equal((await store.list("user_b")).conversations.length, 0);
  await assert.rejects(() => store.page("user_b", conversation.id), notFound);
  await assert.rejects(() => store.begin("user_b", submit(conversation.id, 0)), notFound);
  const run = await store.begin("user_a", submit(conversation.id, 0));
  await assert.rejects(() => store.save("user_b", run, run.message, false), notFound);
});
test("creation and submissions are idempotent; request IDs cannot change content", async () => {
  const key = randomUUID();
  const first = await store.create("user_a", key, "Circle");
  assert.equal((await store.create("user_a", key, "Circle")).id, first.id);
  const input = submit(first.id, 0);
  const run = await store.begin("user_a", input);
  const replay = await store.begin("user_a", input);
  assert.equal(replay.replayed, true); assert.equal(replay.assistantMessageId, run.assistantMessageId);
  await assert.rejects(() => store.begin("user_a", { ...input, kind: "message", content: "Changed" }), /already used/);
  assert.equal((await store.page("user_a", first.id)).messages.length, 2);
});
test("concurrent claims serialize; only one run starts", async () => {
  const conversation = await create();
  const attempts = await Promise.allSettled([store.begin("user_a", submit(conversation.id, 0, "A")), store.begin("user_a", submit(conversation.id, 0, "B"))]);
  assert.equal(attempts.filter(item => item.status === "fulfilled").length, 1);
  const rejected = attempts.find(item => item.status === "rejected");
  assert.ok(rejected?.status === "rejected" && rejected.reason instanceof ConversationError && rejected.reason.status === 409);
  assert.equal((await store.page("user_a", conversation.id)).messages.length, 2);
});
test("saved SVGs restore through their assistant messages and become the next model input", async () => {
  const conversation = await create();
  const first = await store.begin("user_a", submit(conversation.id, 0));
  await complete(first);
  const restored = conversationPageSchema.parse(await store.page("user_a", conversation.id));
  assert.deepEqual(restored.document, doc);
  assert.equal(restored.messages[1].id, first.assistantMessageId);
  assert.equal(restored.messages[1].flow[0].kind, "result");
  const next = await store.begin("user_a", submit(conversation.id, restored.conversation.revision, "Make it blue"));
  assert.equal(next.input.currentSvg, doc.source);
  assert.deepEqual(next.input.messages.map(message => message.content), ["Draw a circle", "Created a circle", "Make it blue"]);
});
test("expired leases are recovered, stale writes rejected, explicit retry reuses the user", async () => {
  const conversation = await create();
  const abandoned = await store.begin("user_a", submit(conversation.id, 0));
  await db.update(conversations).set({ leaseExpiresAt: new Date(Date.now() - 1000) }).where(eq(conversations.id, conversation.id));
  const restored = await store.page("user_a", conversation.id);
  assert.equal(restored.messages[1].runStatus, "interrupted");
  assert.equal(restored.conversation.activeRunId, null);
  await assert.rejects(() => store.save("user_a", abandoned, abandoned.message, false), /interrupted or superseded/);
  const retried = await store.begin("user_a", { kind: "retry", conversationId: conversation.id, retryOf: abandoned.assistantMessageId, requestId: randomUUID(), expectedRevision: restored.conversation.revision });
  assert.equal(retried.userMessageId, abandoned.userMessageId);
  assert.equal((await store.page("user_a", conversation.id)).messages.filter(message => message.role === "user").length, 1);
});
test("failed attempts preserve prior artwork and policy rejection does not poison context", async () => {
  const conversation = await create();
  const first = await store.begin("user_a", submit(conversation.id, 0)); await complete(first);
  const second = await store.begin("user_a", submit(conversation.id, 1, "Rejected prompt"));
  const denied = applyEvent(second.message, { type: "error", message: "Rejected", retryable: false, excludedFromContext: true });
  await store.save("user_a", second, denied, true, undefined, true);
  const restored = await store.page("user_a", conversation.id);
  assert.deepEqual(restored.document, doc);
  const next = await store.begin("user_a", submit(conversation.id, 2, "Make it green"));
  assert.ok(!next.input.messages.some(message => message.content === "Rejected prompt"));
});
test("message and conversation pagination retain stable order without duplicates", async () => {
  const conversation = await create();
  for (let i = 0; i < 8; i++) { const run = await store.begin("user_a", submit(conversation.id, i, `Prompt ${i}`)); await complete(run); }
  const latest = await store.page("user_a", conversation.id);
  const older = await store.page("user_a", conversation.id, latest.olderCursor!);
  assert.equal(latest.messages.length, 10); assert.equal(older.messages.length, 6);
  assert.deepEqual([...older.messages, ...latest.messages].map(message => message.position), Array.from({ length: 16 }, (_, i) => i + 1));
  for (let i = 0; i < 23; i++) await create();
  await db.update(conversations).set({ updatedAt: new Date("2026-10-10T00:00:00.123Z") });
  const list = await store.list("user_a"); const more = await store.list("user_a", list.nextCursor!);
  assert.equal(list.conversations.length, 20); assert.equal(more.conversations.length, 4);
  assert.equal(new Set([...list.conversations, ...more.conversations].map(item => item.id)).size, 24);
});
test("invalid stored SVGs never restore or reach generation", async () => {
  const conversation = await create(); const run = await store.begin("user_a", submit(conversation.id, 0));
  await assert.rejects(() => store.save("user_a", run, applyEvent(run.message, { type: "result", message: "Done", document: { ...doc, source: "<svg><script/></svg>" }, usage }), true, { ...doc, source: "<svg><script/></svg>" }));
  assert.equal((await store.page("user_a", conversation.id)).document, null);
  await complete(run);
  await db.update(svgResults).set({ document: { ...doc, source: "<svg><script/></svg>" } }).where(eq(svgResults.assistantMessageId, run.assistantMessageId));
  await assert.rejects(() => store.page("user_a", conversation.id));
  await assert.rejects(() => store.begin("user_a", submit(conversation.id, 1, "Make it blue")));
  assert.equal((await db.select().from(messages)).length, 2);
});
test("feedback is owned, persisted and rejects expired tokens", async () => {
  const secret = "x".repeat(32); const old = process.env.BRAINTRUST_FEEDBACK_SECRET; process.env.BRAINTRUST_FEEDBACK_SECRET = secret;
  try {
    const conversation = await create(); const run = await store.begin("user_a", submit(conversation.id, 0));
    const token = createFeedbackToken("span", "user_a", secret);
    const message = applyEvent(run.message, { type: "result", message: "Done", document: doc, usage, feedbackToken: token });
    await store.save("user_a", run, message, true, doc);
    await assert.rejects(() => store.saveFeedback("user_b", token, { token, rating: 1, comment: "" }));
    await store.saveFeedback("user_a", token, { token, rating: 1, comment: "Good" });
    assert.equal((await store.page("user_a", conversation.id)).messages[1].feedbackSaved, true);
    const expired = createFeedbackToken("old", "user_a", secret, Date.now() - 8 * 24 * 60 * 60 * 1000);
    await db.update(messages).set({ details: { version: 1, flow: [], retryable: true, feedbackToken: expired } }).where(eq(messages.id, run.assistantMessageId));
    await assert.rejects(() => store.saveFeedback("user_a", expired, { token: expired, rating: 0, comment: "" }));
  } finally { if (old === undefined) delete process.env.BRAINTRUST_FEEDBACK_SECRET; else process.env.BRAINTRUST_FEEDBACK_SECRET = old; }
});
