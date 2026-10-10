import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { selectContext, applyEvent } from "../lib/conversations/state";
import { handleSavedGeneration } from "../lib/conversations/generate";
import { submissionSchema, storedDetailsSchema } from "../lib/conversations/contracts";
import { ConversationError, type StartedRun } from "../lib/conversations/store";
import type { ChatMessage } from "../lib/workspace/types";

const document = { name: "circle.svg", description: "A circle", source: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="30"/></svg>', width: 100, height: 100 };
const usage = { model: "mock", inputTokens: 10, outputTokens: 20, totalTokens: 30, cachedInputTokens: 0 };
function setup() {
  const run: StartedRun = { conversationId: randomUUID(), userMessageId: randomUUID(), assistantMessageId: randomUUID(), revision: 1, replayed: false,
    message: { id: randomUUID(), role: "assistant", content: "", flow: [], runStatus: "running" }, document: null,
    input: { messages: [{ role: "user", content: "A circle" }] } };
  run.message.id = run.assistantMessageId;
  const saved: { message: ChatMessage; terminal: boolean; excluded?: boolean }[] = [];
  const submission = { kind: "message", conversationId: run.conversationId, content: "A circle", requestId: randomUUID(), expectedRevision: 0 };
  const request = new Request("http://localhost/api/generate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(submission) });
  const store = { begin: async () => run, save: async (_owner: string, _run: StartedRun, message: ChatMessage, terminal: boolean, _doc?: unknown, excluded?: boolean) => { saved.push({ message: structuredClone(message), terminal, excluded }); } };
  const generate = async () => ({ output: { message: "Created a circle", filename: document.name, svg: document.source }, usage });
  return { run, saved, request, store, generate };
}
const policy = async () => ({ kind: "generation" as const });
const events = async (response: Response) => (await response.text()).trim().split("\n").map(line => JSON.parse(line));

test("public submission rejects client-owned history and artwork", () => {
  const { run } = setup();
  const valid = { kind: "message", conversationId: run.conversationId, content: "Draw", requestId: randomUUID(), expectedRevision: 0 };
  assert.ok(submissionSchema.safeParse(valid).success);
  for (const extra of [{ messages: [] }, { currentSvg: document.source }, { ownerId: "someone" }]) assert.equal(submissionSchema.safeParse({ ...valid, ...extra }).success, false);
});
test("context selects recent whole turns and excludes rejected prompts and failed replies", () => {
  const context = selectContext([
    { role: "assistant", content: "Orphan", runStatus: "completed" },
    { role: "user", content: "Rejected", excludedFromContext: true },
    { role: "assistant", content: "Failure", runStatus: "error" },
    ...Array.from({ length: 12 }, (_, i) => [{ role: "user" as const, content: `Prompt ${i}` }, { role: "assistant" as const, content: `Reply ${i}`, runStatus: "completed" as const }]).flat(),
  ], "Make it blue");
  assert.equal(context.length, 19);
  assert.equal(context[0].content, "Prompt 3");
  assert.equal(context.at(-1)?.content, "Make it blue");
  assert.ok(!context.some(message => ["Rejected", "Failure", "Orphan"].includes(message.content)));
});
test("context enforces character budget without deleting stored history", () => {
  const history = Array.from({ length: 8 }, () => [{ role: "user" as const, content: "u".repeat(2000) }, { role: "assistant" as const, content: "a".repeat(2000), runStatus: "completed" as const }]).flat();
  assert.equal(selectContext(history, "next").length, 7);
  assert.equal(history.length, 16);
});
test("persistence waits for the final database commit before exposing success", async () => {
  const { request, store, generate, run } = setup();
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let committing!: () => void;
  const atCommit = new Promise<void>(resolve => { committing = resolve; });
  store.save = async () => { committing(); await gate; };
  const response = await handleSavedGeneration(request, "owner", generate, { store, checkPolicy: policy });
  const reader = response.body!.getReader();
  const first = new TextDecoder().decode((await reader.read()).value);
  assert.match(first, /"type":"started"/); assert.match(first, new RegExp(run.assistantMessageId));
  const progress = new TextDecoder().decode((await reader.read()).value);
  assert.match(progress, /"type":"progress"/);
  await atCommit;
  let delivered = false;
  const final = reader.read().then(value => { delivered = true; return value; });
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(delivered, false);
  release();
  assert.match(new TextDecoder().decode((await final).value), /"type":"result"/);
  await reader.cancel();
});
test("policy rejection is saved, excluded from context, and never calls SVG generation", async () => {
  const { request, store, saved } = setup();
  const { InputPolicyError } = await import("../lib/ai/input-policy");
  const response = await handleSavedGeneration(request, "owner", async () => { throw new Error("Must not generate"); }, { store, checkPolicy: async () => { throw new InputPolicyError("Rejected", 422); } });
  const output = await events(response);
  assert.equal(output.at(-1).retryable, false);
  assert.equal(saved[0].excluded, true); assert.equal(saved[0].message.runStatus, "error");
});
test("clarification replies are persisted without replacing artwork", async () => {
  const { request, store, saved, generate } = setup();
  const output = await events(await handleSavedGeneration(request, "owner", generate, { store, checkPolicy: async () => ({ kind: "reply", reason: "clarification", message: "Which color?" }) }));
  assert.equal(output.at(-1).type, "reply"); assert.equal(saved[0].message.content, "Which color?"); assert.equal(saved[0].terminal, true);
});
test("failed final persistence emits an error, never success or an unsaved SVG checkpoint", async () => {
  const { request, store, generate, saved } = setup();
  const original = store.save;
  let writes = 0;
  store.save = async (...args) => { if (++writes === 1) throw new Error("DATABASE_SECRET"); return original(...args); };
  const output = await events(await handleSavedGeneration(request, "owner", generate, { store, checkPolicy: policy }));
  assert.equal(output.at(-1).type, "error"); assert.ok(!output.some(event => event.type === "result"));
  assert.ok(!saved[0].message.flow?.some(entry => entry.kind === "result"));
  assert.doesNotMatch(JSON.stringify(output), /DATABASE_SECRET/);
});
test("ownership/storage failures stop before model execution", async () => {
  const { request, store } = setup();
  store.begin = async () => { throw new ConversationError("Conversation not found.", 404); };
  assert.equal((await handleSavedGeneration(request, "other", async () => { throw new Error("Must not generate"); }, { store })).status, 404);
});
test("duplicate completed requests replay the existing result without saving or calling the model", async () => {
  const { request, store, run, saved } = setup();
  run.replayed = true; run.document = document;
  run.message = applyEvent(run.message, { type: "result", message: "Created a circle", document, usage });
  const output = await events(await handleSavedGeneration(request, "owner", async () => { throw new Error("Must not generate"); }, { store }));
  assert.equal(output[0].replayed, true); assert.equal(output.at(-1).type, "result"); assert.equal(saved.length, 0);
});
test("stored timeline references final artwork instead of embedding it again", () => {
  assert.ok(storedDetailsSchema.safeParse({ version: 1, flow: [{ kind: "result", message: "Done", resultId: randomUUID() }], retryable: true }).success);
  assert.equal(storedDetailsSchema.safeParse({ version: 1, flow: [{ kind: "result", message: "Done", document }], retryable: true }).success, false);
});

test("disconnect cancels the model and saves an interrupted attempt", async () => {
  const { request, store, saved } = setup();
  let savedTerminal!: () => void;
  const finished = new Promise<void>(resolve => { savedTerminal = resolve; });
  const original = store.save;
  store.save = async (...args) => { await original(...args); if (args[3]) savedTerminal(); };
  let started!: () => void;
  const modelStarted = new Promise<void>(resolve => { started = resolve; });
  const response = await handleSavedGeneration(request, "owner", async (_, signal) => {
    started();
    return new Promise((_, reject) => signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true }));
  }, { store, checkPolicy: policy });
  const reader = response.body!.getReader();
  await reader.read(); await modelStarted; await reader.cancel();
  await Promise.race([finished, new Promise((_, reject) => setTimeout(() => reject(new Error("Interruption was not saved")), 2000))]);
  assert.equal(saved.at(-1)?.message.runStatus, "interrupted");
});

test("unsafe final SVGs are persisted as failure without a result", async () => {
  const { request, store, saved } = setup();
  const output = await events(await handleSavedGeneration(request, "owner", async () => ({ output: { message: "Bad", filename: "bad.svg", svg: "<svg><script/></svg>" }, usage }), { store, checkPolicy: policy }));
  assert.equal(output.at(-1).type, "error");
  assert.equal(saved.at(-1)?.message.runStatus, "error");
  assert.ok(!saved.at(-1)?.message.flow?.some(entry => entry.kind === "result"));
});
