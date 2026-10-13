import assert from "node:assert/strict";
import { test } from "node:test";
import {
  GenerationRequestError,
  requestGeneration,
} from "../lib/workspace/generate-client";
import type { GenerationEvent } from "../lib/workspace/contracts";
import { loadConversation } from "../lib/conversations/client";

test("saved conversation loads preserve denied/missing and temporary failure statuses", async (context) => {
  for (const status of [403, 404, 503]) {
    context.mock.method(globalThis, "fetch", async () =>
      Response.json({ error: "Conversation is unavailable." }, { status }),
    );
    await assert.rejects(
      () => loadConversation("00000000-0000-4000-8000-000000000001"),
      (error) =>
        error instanceof GenerationRequestError && error.status === status,
    );
    context.mock.restoreAll();
  }
});

const result: GenerationEvent = {
  type: "result",
  usage: {
    model: "gpt-6-luna",
    inputTokens: 100,
    outputTokens: 100,
    cachedInputTokens: 0,
    totalTokens: 200,
  },
  message: "Created a café icon.",
  document: {
    name: "cafe.svg",
    description: "Café",
    width: 100,
    height: 100,
    source: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"/>',
  },
};
const input = { messages: [{ role: "user" as const, content: "Draw a café" }] };

test("client accepts a terminal conversational reply without an SVG", async (context) => {
  const reply = {
    type: "reply",
    reason: "conversation",
    message: "You’re welcome!",
  };
  context.mock.method(
    globalThis,
    "fetch",
    async () =>
      new Response(JSON.stringify(reply) + "\n", {
        headers: { "Content-Type": "application/x-ndjson" },
      }),
  );
  const events: GenerationEvent[] = [];
  await requestGeneration(input, new AbortController().signal, (event) =>
    events.push(event),
  );
  assert.deepEqual(events, [reply]);
});

test("client rejects artwork or feedback attached to a conversational reply", async (context) => {
  context.mock.method(
    globalThis,
    "fetch",
    async () =>
      new Response(
        JSON.stringify({
          type: "reply",
          reason: "conversation",
          message: "Hello",
          document: result.document,
          feedbackToken: "bad",
        }) + "\n",
        { headers: { "Content-Type": "application/x-ndjson" } },
      ),
  );
  await assert.rejects(() =>
    requestGeneration(input, new AbortController().signal, () => {}),
  );
});

test("client rejects extra events after a terminal reply", async (context) => {
  context.mock.method(
    globalThis,
    "fetch",
    async () =>
      new Response(
        JSON.stringify({
          type: "reply",
          reason: "conversation",
          message: "Hello",
        }) +
          "\n" +
          JSON.stringify(result) +
          "\n",
        { headers: { "Content-Type": "application/x-ndjson" } },
      ),
  );
  await assert.rejects(
    () => requestGeneration(input, new AbortController().signal, () => {}),
    /after generation finished/,
  );
});

test("client distinguishes policy rejection from temporary check failure", async (context) => {
  for (const status of [422, 503]) {
    context.mock.method(globalThis, "fetch", async () =>
      Response.json({ error: "Safe message" }, { status }),
    );
    await assert.rejects(
      () =>
        requestGeneration(input, new AbortController().signal, () => {
          throw new Error("Must not emit generation events");
        }),
      (error) =>
        error instanceof GenerationRequestError &&
        error.status === status &&
        error.message === "Safe message",
    );
    context.mock.restoreAll();
  }
});

test("client sends messages and decodes JSON records split across UTF-8 chunks", async (t) => {
  const bytes = new TextEncoder().encode(
    JSON.stringify({ type: "progress", characters: 0 }) +
      "\n" +
      JSON.stringify(result) +
      "\n",
  );
  t.mock.method(
    globalThis,
    "fetch",
    async (url: string, options: RequestInit) => {
      assert.equal(url, "/api/generate");
      assert.equal(options.method, "POST");
      assert.deepEqual(JSON.parse(options.body as string), input);
      return new Response(
        new ReadableStream({
          start(controller) {
            for (const byte of bytes)
              controller.enqueue(new Uint8Array([byte]));
            controller.close();
          },
        }),
        { headers: { "Content-Type": "application/x-ndjson" } },
      );
    },
  );
  const events: GenerationEvent[] = [];
  await requestGeneration(input, new AbortController().signal, (event) =>
    events.push(event),
  );
  assert.deepEqual(events, [{ type: "progress", characters: 0 }, result]);
});

for (const [name, response, pattern] of [
  [
    "HTTP error",
    () => Response.json({ error: "Invalid conversation" }, { status: 400 }),
    /Invalid conversation/,
  ],
  [
    "stream error",
    () =>
      new Response('{"type":"error","message":"Unsafe SVG"}\n', {
        headers: { "Content-Type": "application/x-ndjson" },
      }),
    /Unsafe SVG/,
  ],
  [
    "incomplete stream",
    () =>
      new Response('{"type":"progress","characters":20}\n', {
        headers: { "Content-Type": "application/x-ndjson" },
      }),
    /ended before/,
  ],
] as const) {
  test(`client reports ${name}`, async (t) => {
    t.mock.method(globalThis, "fetch", async () => response());
    await assert.rejects(
      () => requestGeneration(input, new AbortController().signal, () => {}),
      pattern,
    );
  });
}
