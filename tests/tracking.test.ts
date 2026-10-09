import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { OTELIDGenerator } from "braintrust";
import { createFeedbackToken, verifyFeedbackToken } from "../lib/ai/feedback-token";
import { handleFeedback } from "../lib/ai/handle-feedback";
import { createGenerationObserver } from "../lib/ai/tracking";
import { handleGeneration } from "../lib/ai/handle-generation";
import { generationRequestSchema, type GenerationRequest } from "../lib/workspace/contracts";

const secret = "test-secret-only-".repeat(4);
const user = "user_test";
// Exercise the installed SDK's default row ID format, not a fabricated UUID.
const id = new OTELIDGenerator().getSpanId();
const input: GenerationRequest = { conversationId: randomUUID(), messages: [{ role: "user", content: "A blue circle" }] };
const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="30" fill="blue"/></svg>';
const usage = { model: "mock", inputTokens: 100, outputTokens: 50, cachedInputTokens: 0, totalTokens: 150 };
const generated = { output: { message: "A blue circle.", filename: "circle.svg", svg }, usage };
const request = (body: unknown, path = "feedback") => new Request(`http://localhost/api/${path}`, {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
});

test("feedback token binds a result to its user, signing key, and expiry", () => {
  const now = 1000;
  const token = createFeedbackToken(id, user, secret, now);
  assert.equal(verifyFeedbackToken(token, user, secret, now + 1), id);
  assert.equal(verifyFeedbackToken(token, "other_user", secret, now), null);
  assert.equal(verifyFeedbackToken(token, user, "other-secret", now), null);
  assert.equal(verifyFeedbackToken(token, user, secret, now + 8 * 86400000), null);
  assert.equal(verifyFeedbackToken(token, user, secret, now - 1), null);
  assert.equal(verifyFeedbackToken(token.replace(/^./, "x"), user, secret, now), null);
  assert.equal(verifyFeedbackToken(`${token}.extra`, user, secret, now), null);
});

test("feedback also accepts legacy UUID row IDs but rejects empty or oversized signed IDs", () => {
  const legacyId = randomUUID();
  assert.equal(verifyFeedbackToken(createFeedbackToken(legacyId, user, secret), user, secret), legacyId);
  for (const invalidId of ["", "x".repeat(201)]) {
    assert.equal(verifyFeedbackToken(createFeedbackToken(invalidId, user, secret), user, secret), null);
  }
});

test("conversation IDs must be UUIDs and cannot introduce a user ID", () => {
  assert.equal(generationRequestSchema.safeParse(input).success, true);
  assert.equal(generationRequestSchema.safeParse({ ...input, conversationId: "bad" }).success, false);
  assert.equal(generationRequestSchema.safeParse({ ...input, userId: "forged" }).success, false);
});

test("feedback validates auth, ownership, rating, and size before saving", async () => {
  const token = createFeedbackToken(id, user, secret);
  let saves = 0;
  const save = async () => { saves++; };
  const feedback = { token, rating: 1, comment: "Nice!" };
  assert.equal((await handleFeedback(request(feedback), null, secret, save)).status, 401);
  assert.equal((await handleFeedback(request(feedback), user, undefined, save)).status, 503);
  assert.equal((await handleFeedback(request(feedback), "other_user", secret, save)).status, 403);
  assert.equal((await handleFeedback(request({ ...feedback, rating: 2 }), user, secret, save)).status, 400);
  assert.equal((await handleFeedback(request({ ...feedback, comment: "x".repeat(1001) }), user, secret, save)).status, 400);
  assert.equal((await handleFeedback(request({ ...feedback, userId: user }), user, secret, save)).status, 400);
  assert.equal((await handleFeedback(request({ ...feedback, comment: "x".repeat(8001) }), user, secret, save)).status, 413);
  assert.equal(saves, 0);
});

test("feedback persists score and optional reason/comment for the verified generation", async () => {
  const body = { token: createFeedbackToken(id, user, secret), rating: 0, reason: "Looks wrong", comment: "  Missing a wheel.  " };
  let saved = false;
  const response = await handleFeedback(request(body), user, secret, async (spanId, feedback, owner) => {
    assert.equal(spanId, id);
    assert.equal(owner, user);
    assert.equal(feedback.rating, 0);
    assert.equal(feedback.reason, "Looks wrong");
    assert.equal(feedback.comment, "Missing a wheel.");
    saved = true;
  });
  assert.equal(response.status, 200);
  assert.equal(saved, true);
});

test("feedback upload failure returns a retryable error without leaking credentials", async () => {
  const response = await handleFeedback(request({ token: createFeedbackToken(id, user, secret), rating: 1 }), user, secret, async () => { throw new Error("private provider error"); });
  assert.equal(response.status, 503);
  assert.equal((await response.text()).includes("private provider error"), false);
});

function fakeSpan() {
  const records: Record<string, unknown>[] = [];
  let ended = 0;
  return { records, get ended() { return ended; }, id, log: (value: Record<string, unknown>) => { records.push(value); }, end: () => { ended++; return 0; } };
}

test("generation trace contains final validated SVG, history, tool results and tokens", async () => {
  const span = fakeSpan();
  const response = await handleGeneration(request(input, "generate"), async (_input, _signal, _progress, event) => {
    event?.({ type: "tool", call: { id: "call-1", name: "webSearch", step: 1, status: "running", input: { query: "circle" } } });
    event?.({ type: "tool", call: { id: "call-1", name: "webSearch", step: 1, status: "completed", output: { ok: true, query: "circle", results: [] } } });
    return generated;
  }, undefined, async () => {}, value => createGenerationObserver(span, value, user, secret));
  const events = (await response.text()).trim().split("\n").map(line => JSON.parse(line));
  const result = events.at(-1);
  assert.equal(result.type, "result");
  assert.equal(verifyFeedbackToken(result.feedbackToken, user, secret), id);
  assert.deepEqual(span.records[0].input, { messages: input.messages, currentSvg: null });
  assert.equal((span.records[0].metadata as Record<string, unknown>).conversationId, input.conversationId);
  const output = span.records.find(row => row.output)?.output as { document: { source: string } };
  assert.equal(output.document.source, result.document.source);
  assert.equal((span.records.find(row => row.metrics)?.metrics as Record<string, unknown>).tokens, 150);
  const meta = span.records.at(-1)?.metadata as { status: string; tools: { input: { query: string } }[] };
  assert.equal(meta.status, "completed");
  assert.equal(meta.tools[0].input.query, "circle");
  assert.equal(span.ended, 1);
  assert.equal(JSON.stringify(span.records).includes(result.feedbackToken), false);
  let feedbackSaved = false;
  const feedbackResponse = await handleFeedback(request({ token: result.feedbackToken, rating: 1 }), user, secret, async spanId => {
    assert.equal(spanId, id);
    feedbackSaved = true;
  });
  assert.equal(feedbackResponse.status, 200);
  assert.equal(feedbackSaved, true);
});

test("unsafe generation records failure and never issues feedback permission", async () => {
  const span = fakeSpan();
  const response = await handleGeneration(request(input, "generate"), async () => ({ ...generated, output: { ...generated.output, svg: '<svg><script>alert(1)</script></svg>' } }), undefined, async () => {}, value => createGenerationObserver(span, value, user, secret));
  const body = await response.text();
  assert.equal(body.includes("feedbackToken"), false);
  assert.equal(span.records.some(row => row.output), false);
  assert.equal((span.records.at(-1)?.metadata as { status: string }).status, "error");
});

test("tracking failure does not break generation, and disabled tracking has no feedback token", async () => {
  const observer = createGenerationObserver({ id, log() { throw new Error("unavailable"); }, end() { throw new Error("unavailable"); } }, input, user);
  const response = await handleGeneration(request(input, "generate"), async () => generated, undefined, async () => {}, () => observer);
  const body = await response.text();
  assert.equal(body.includes('"type":"result"'), true);
  assert.equal(body.includes("feedbackToken"), false);
});

test("cancelled observer ends only once", () => {
  const span = fakeSpan();
  const observer = createGenerationObserver(span, input, user);
  observer.finish();
  observer.finish();
  assert.equal(span.ended, 1);
  assert.equal((span.records.at(-1)?.metadata as { status: string }).status, "cancelled");
});
