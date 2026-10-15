import assert from "node:assert/strict";
import { test, before, after, beforeEach } from "node:test";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import {
  createConversationStore,
  ConversationError,
} from "../../lib/conversations/store";
import type { withDatabase } from "../../lib/db/client";
import {
  conversations,
  messages,
  svgResults,
  collectionIcons,
  collectionUsage,
  collectionReferences,
} from "../../lib/db/schema";
import { applyEvent } from "../../lib/conversations/state";
import {
  conversationPageSchema,
  type Submission,
} from "../../lib/conversations/contracts";
import { createFeedbackToken } from "../../lib/ai/feedback-token";
import { readPublicSvg, publicSvgResponse } from "../../lib/svg/public-result";
import { resolvePublicId } from "../../lib/svg/public-result";
import { publicIdSchema } from "../../lib/svg/public-id";

// This suite intentionally requires a disposable database; it truncates its tables.
const connectionString = process.env.TEST_DATABASE_URL;
if (
  !connectionString ||
  !new URL(connectionString).pathname.startsWith("/svg_conversations_test")
)
  throw new Error(
    "Set TEST_DATABASE_URL to a disposable svg_conversations_test* database.",
  );
const pool = new Pool({ connectionString });
const db = drizzle(pool);
const runDatabase: typeof withDatabase = async (action) =>
  action(db as unknown as Parameters<Parameters<typeof withDatabase>[0]>[0]);
const store = createConversationStore(runDatabase);
const doc = {
  name: "circle.svg",
  description: "Circle",
  source:
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="30"/></svg>',
  width: 100,
  height: 100,
};
const usage = {
  model: "mock",
  inputTokens: 10,
  outputTokens: 20,
  cachedInputTokens: 0,
  totalTokens: 30,
};
before(async () => {
  await pool.query(
    "DROP TABLE IF EXISTS collection_references, collection_usage, collection_icons, collections, svg_results, messages, conversations CASCADE",
  );
  const legacyConversation = randomUUID(),
    legacyMessage = randomUUID(),
    legacyResult = randomUUID();
  for (const name of (await readdir("drizzle"))
    .filter((name) => name.endsWith(".sql"))
    .sort()) {
    await pool.query(await readFile(`drizzle/${name}`, "utf8"));
    if (name === "0000_conversation_persistence.sql") {
      await pool.query(
        "INSERT INTO conversations (id, owner_id, creation_request_id, title) VALUES ($1, 'legacy-owner', $2, 'Private prompt')",
        [legacyConversation, randomUUID()],
      );
      await pool.query(
        "INSERT INTO messages (id, conversation_id, position, role, status, details) VALUES ($1, $2, 1, 'assistant', 'completed', '{}')",
        [legacyMessage, legacyConversation],
      );
      await pool.query(
        "INSERT INTO svg_results (id, assistant_message_id, document) VALUES ($1, $2, $3)",
        [legacyResult, legacyMessage, JSON.stringify(doc)],
      );
    }
  }
  const { rows } = await pool.query(
    "SELECT id, public_id, document FROM svg_results WHERE id = $1",
    [legacyResult],
  );
  assert.equal(rows[0].id, legacyResult);
  assert.ok(publicIdSchema.safeParse(rows[0].public_id).success);
  assert.deepEqual(rows[0].document, doc);
});
beforeEach(async () => {
  await pool.query(
    "TRUNCATE collection_usage, collections, svg_results, messages, conversations CASCADE",
  );
});
after(async () => {
  await pool.end();
});
async function create(owner = "user_a") {
  return store.create(owner, randomUUID(), "Draw a circle");
}
function submit(
  conversationId: string,
  expectedRevision: number,
  content = "Draw a circle",
): Submission {
  return {
    kind: "message",
    conversationId,
    content,
    expectedRevision,
    requestId: randomUUID(),
  };
}
async function complete(
  run: Awaited<ReturnType<typeof store.begin>>,
  owner = "user_a",
) {
  const message = applyEvent(run.message, {
    type: "result",
    message: "Created a circle",
    document: doc,
    usage,
  });
  await store.save(owner, run, message, true, doc);
}
const notFound = (error: unknown) =>
  error instanceof ConversationError && error.status === 404;

test("public sharing exposes only SVG source and becomes unavailable after conversation deletion", async () => {
  const conversation = await create();
  const run = await store.begin("user_a", submit(conversation.id, 0));
  await complete(run);
  const page = await store.page("user_a", conversation.id);
  assert.ok(page.publicId);
  assert.ok(publicIdSchema.safeParse(page.publicId).success);
  const [result] = await db
    .select()
    .from(svgResults)
    .where(eq(svgResults.assistantMessageId, run.assistantMessageId));
  assert.equal(await resolvePublicId(result.id, runDatabase), page.publicId);
  const read = (id: string) => readPublicSvg(id, runDatabase);
  const response = await publicSvgResponse(page.publicId, read);
  assert.equal(response.status, 200);
  assert.equal(await response.text(), doc.source);
  assert.equal(
    await (await publicSvgResponse(result.id, read)).text(),
    doc.source,
  );
  const next = await store.begin(
    "user_a",
    submit(conversation.id, page.conversation.revision, "Make it blue"),
  );
  await complete(next);
  const updated = await store.page("user_a", conversation.id);
  assert.notEqual(updated.publicId, page.publicId);
  assert.equal((await publicSvgResponse(page.publicId, read)).status, 200);
  await db.delete(conversations).where(eq(conversations.id, conversation.id));
  assert.equal((await publicSvgResponse(page.publicId, read)).status, 404);
});

test("owner isolation applies to lists, reads, claims and writes", async () => {
  const conversation = await create();
  assert.equal((await store.list("user_b")).conversations.length, 0);
  await assert.rejects(() => store.page("user_b", conversation.id), notFound);
  await assert.rejects(
    () => store.begin("user_b", submit(conversation.id, 0)),
    notFound,
  );
  const run = await store.begin("user_a", submit(conversation.id, 0));
  await assert.rejects(
    () => store.save("user_b", run, run.message, false),
    notFound,
  );
});
test("creation and submissions are idempotent; request IDs cannot change content", async () => {
  const key = randomUUID();
  const first = await store.create("user_a", key, "Circle");
  assert.equal((await store.create("user_a", key, "Circle")).id, first.id);
  const input = submit(first.id, 0);
  const run = await store.begin("user_a", input);
  const replay = await store.begin("user_a", input);
  assert.equal(replay.replayed, true);
  assert.equal(replay.assistantMessageId, run.assistantMessageId);
  await assert.rejects(
    () =>
      store.begin("user_a", { ...input, kind: "message", content: "Changed" }),
    /already used/,
  );
  assert.equal((await store.page("user_a", first.id)).messages.length, 2);
});
test("concurrent claims serialize; only one run starts", async () => {
  const conversation = await create();
  const attempts = await Promise.allSettled([
    store.begin("user_a", submit(conversation.id, 0, "A")),
    store.begin("user_a", submit(conversation.id, 0, "B")),
  ]);
  assert.equal(
    attempts.filter((item) => item.status === "fulfilled").length,
    1,
  );
  const rejected = attempts.find((item) => item.status === "rejected");
  assert.ok(
    rejected?.status === "rejected" &&
      rejected.reason instanceof ConversationError &&
      rejected.reason.status === 409,
  );
  assert.equal(
    (await store.page("user_a", conversation.id)).messages.length,
    2,
  );
});
test("saved SVGs restore through their assistant messages and become the next model input", async () => {
  const conversation = await create();
  const first = await store.begin("user_a", submit(conversation.id, 0));
  await complete(first);
  const restored = conversationPageSchema.parse(
    await store.page("user_a", conversation.id),
  );
  assert.deepEqual(restored.document, doc);
  assert.equal(restored.messages[1].id, first.assistantMessageId);
  assert.equal(restored.messages[1].flow[0].kind, "result");
  const next = await store.begin(
    "user_a",
    submit(conversation.id, restored.conversation.revision, "Make it blue"),
  );
  assert.equal(next.input.currentSvg, doc.source);
  assert.deepEqual(
    next.input.messages.map((message) => message.content),
    ["Draw a circle", "Created a circle", "Make it blue"],
  );
});
test("expired leases are recovered, stale writes rejected, explicit retry reuses the user", async () => {
  const conversation = await create();
  const abandoned = await store.begin("user_a", submit(conversation.id, 0));
  await db
    .update(conversations)
    .set({ leaseExpiresAt: new Date(Date.now() - 1000) })
    .where(eq(conversations.id, conversation.id));
  const restored = await store.page("user_a", conversation.id);
  assert.equal(restored.messages[1].runStatus, "interrupted");
  assert.equal(restored.conversation.activeRunId, null);
  await assert.rejects(
    () => store.save("user_a", abandoned, abandoned.message, false),
    /interrupted or superseded/,
  );
  const retried = await store.begin("user_a", {
    kind: "retry",
    conversationId: conversation.id,
    retryOf: abandoned.assistantMessageId,
    requestId: randomUUID(),
    expectedRevision: restored.conversation.revision,
  });
  assert.equal(retried.userMessageId, abandoned.userMessageId);
  assert.equal(
    (await store.page("user_a", conversation.id)).messages.filter(
      (message) => message.role === "user",
    ).length,
    1,
  );
});
test("failed attempts preserve prior artwork and policy rejection does not poison context", async () => {
  const conversation = await create();
  const first = await store.begin("user_a", submit(conversation.id, 0));
  await complete(first);
  const second = await store.begin(
    "user_a",
    submit(conversation.id, 1, "Rejected prompt"),
  );
  const denied = applyEvent(second.message, {
    type: "error",
    message: "Rejected",
    retryable: false,
    excludedFromContext: true,
  });
  await store.save("user_a", second, denied, true, undefined, true);
  const restored = await store.page("user_a", conversation.id);
  assert.deepEqual(restored.document, doc);
  const next = await store.begin(
    "user_a",
    submit(conversation.id, 2, "Make it green"),
  );
  assert.ok(
    !next.input.messages.some(
      (message) => message.content === "Rejected prompt",
    ),
  );
});
test("message and conversation pagination retain stable order without duplicates", async () => {
  const conversation = await create();
  for (let i = 0; i < 8; i++) {
    const run = await store.begin(
      "user_a",
      submit(conversation.id, i, `Prompt ${i}`),
    );
    await complete(run);
  }
  const latest = await store.page("user_a", conversation.id);
  const older = await store.page(
    "user_a",
    conversation.id,
    latest.olderCursor!,
  );
  assert.equal(latest.messages.length, 10);
  assert.equal(older.messages.length, 6);
  assert.deepEqual(
    [...older.messages, ...latest.messages].map((message) => message.position),
    Array.from({ length: 16 }, (_, i) => i + 1),
  );
  for (let i = 0; i < 23; i++) await create();
  await db
    .update(conversations)
    .set({ updatedAt: new Date("2026-10-10T00:00:00.123Z") });
  const list = await store.list("user_a");
  const more = await store.list("user_a", list.nextCursor!);
  assert.equal(list.conversations.length, 20);
  assert.equal(more.conversations.length, 4);
  assert.equal(
    new Set(
      [...list.conversations, ...more.conversations].map((item) => item.id),
    ).size,
    24,
  );
});
test("invalid stored SVGs never restore or reach generation", async () => {
  const conversation = await create();
  const run = await store.begin("user_a", submit(conversation.id, 0));
  await assert.rejects(() =>
    store.save(
      "user_a",
      run,
      applyEvent(run.message, {
        type: "result",
        message: "Done",
        document: { ...doc, source: "<svg><script/></svg>" },
        usage,
      }),
      true,
      { ...doc, source: "<svg><script/></svg>" },
    ),
  );
  assert.equal((await store.page("user_a", conversation.id)).document, null);
  await complete(run);
  await db
    .update(svgResults)
    .set({ document: { ...doc, source: "<svg><script/></svg>" } })
    .where(eq(svgResults.assistantMessageId, run.assistantMessageId));
  await assert.rejects(() => store.page("user_a", conversation.id));
  await assert.rejects(() =>
    store.begin("user_a", submit(conversation.id, 1, "Make it blue")),
  );
  await assert.rejects(() => store.list("user_a", undefined, true));
  assert.equal((await db.select().from(messages)).length, 2);
});
test("gallery lists the latest completed SVG, empty conversations and only the owner's artwork", async () => {
  const empty = await create();
  const conversation = await create();
  const first = await store.begin("user_a", submit(conversation.id, 0));
  await complete(first);
  const second = await store.begin(
    "user_a",
    submit(conversation.id, 1, "Make it blue"),
  );
  const blue = {
    ...doc,
    name: "blue.svg",
    source: doc.source.replace('r="30"', 'r="30" fill="blue"'),
  };
  await store.save(
    "user_a",
    second,
    applyEvent(second.message, {
      type: "result",
      message: "Blue circle",
      document: blue,
      usage,
    }),
    true,
    blue,
  );
  const failed = await store.begin(
    "user_a",
    submit(conversation.id, 2, "Try another"),
  );
  await store.save(
    "user_a",
    failed,
    applyEvent(failed.message, { type: "error", message: "Failed" }),
    true,
  );
  const gallery = await store.list("user_a", undefined, true);
  assert.deepEqual(
    gallery.conversations.find((item) => item.id === conversation.id)?.document,
    blue,
  );
  assert.equal(
    gallery.conversations.find((item) => item.id === empty.id)?.document,
    null,
  );
  assert.equal(
    (await store.list("user_b", undefined, true)).conversations.length,
    0,
  );
  assert.ok(
    (await store.list("user_a")).conversations.every(
      (item) => !("document" in item),
    ),
  );
});
test("feedback is owned, persisted and rejects expired tokens", async () => {
  const secret = "x".repeat(32);
  const old = process.env.BRAINTRUST_FEEDBACK_SECRET;
  process.env.BRAINTRUST_FEEDBACK_SECRET = secret;
  try {
    const conversation = await create();
    const run = await store.begin("user_a", submit(conversation.id, 0));
    const token = createFeedbackToken("span", "user_a", secret);
    const message = applyEvent(run.message, {
      type: "result",
      message: "Done",
      document: doc,
      usage,
      feedbackToken: token,
    });
    await store.save("user_a", run, message, true, doc);
    await assert.rejects(() =>
      store.saveFeedback("user_b", token, { token, rating: 1, comment: "" }),
    );
    await store.saveFeedback("user_a", token, {
      token,
      rating: 1,
      comment: "Good",
    });
    assert.equal(
      (await store.page("user_a", conversation.id)).messages[1].feedbackSaved,
      true,
    );
    const expired = createFeedbackToken(
      "old",
      "user_a",
      secret,
      Date.now() - 8 * 24 * 60 * 60 * 1000,
    );
    await db
      .update(messages)
      .set({
        details: {
          version: 1,
          flow: [],
          retryable: true,
          feedbackToken: expired,
        },
      })
      .where(eq(messages.id, run.assistantMessageId));
    await assert.rejects(() =>
      store.saveFeedback("user_a", expired, {
        token: expired,
        rating: 0,
        comment: "",
      }),
    );
  } finally {
    if (old === undefined) delete process.env.BRAINTRUST_FEEDBACK_SECRET;
    else process.env.BRAINTRUST_FEEDBACK_SECRET = old;
  }
});

// Collection infrastructure uses only synthetic SVGs and mocked providers.
import { createCollectionStore } from "../../lib/collections/store";
import { createCollectionProcessor } from "../../lib/collections/process";
import { createOwnedCollectionReferenceRetriever } from "../../lib/collections/retrieval";
import type { CollectionProviders } from "../../lib/collections/providers";

const collectionStore = createCollectionStore(runDatabase);
const ragStore = createConversationStore(runDatabase, async () => {});
const vector = [1, ...Array(1535).fill(0)];
const providers: CollectionProviders = {
  describe: async () => ({
    description: "A synthetic outline circle",
    tags: ["circle", "round"],
    usage,
  }),
  embed: async (values) => ({
    embeddings: values.map(() => vector),
    usage: {
      model: "text-embedding-3-small",
      tokens: values.length * 5,
      dimensions: 1536,
    },
  }),
};
const render = async () => Buffer.from("mock PNG");
async function fixture(owner = "user_a", count = 1) {
  const collection = await collectionStore.create(owner, "Synthetic circles");
  await collectionStore.upload(
    owner,
    collection.id,
    Array.from({ length: count }, (_, i) => ({
      filename: `circle-${i}.svg`,
      source: doc.source.replace('r="30"', `r="${30 + i}"`),
    })),
  );
  return collection;
}
const processIcons = createCollectionProcessor(runDatabase, providers, render);
const searchIcons = createOwnedCollectionReferenceRetriever({
  runDatabase,
  providers,
});
const signal = () => new AbortController().signal;

test("collection upload partially succeeds, deduplicates and isolates owners", async () => {
  const collection = await collectionStore.create("user_a", "Synthetic");
  const uploaded = await collectionStore.upload("user_a", collection.id, [
    { filename: "circle.svg", source: doc.source },
    { filename: "unsafe.svg", source: "<svg><script/></svg>" },
    { filename: "same.svg", source: doc.source },
  ]);
  assert.deepEqual(
    uploaded.results.map((row) => row.ok),
    [true, false, true],
  );
  assert.equal(
    "duplicate" in uploaded.results[2] && uploaded.results[2].duplicate,
    true,
  );
  assert.equal(
    (await collectionStore.page("user_a", collection.id)).icons.length,
    1,
  );
  assert.equal((await collectionStore.list("user_b")).length, 0);
  await assert.rejects(
    () => collectionStore.page("user_b", collection.id),
    notFound,
  );
  await assert.rejects(
    () => processIcons("user_b", collection.id, signal()),
    notFound,
  );
  await assert.rejects(
    () =>
      searchIcons({
        authenticatedUserId: "user_b",
        collectionId: collection.id,
        query: "circle",
        signal: signal(),
      }),
    notFound,
  );
  await assert.rejects(
    () => collectionStore.remove("user_b", collection.id),
    notFound,
  );
});
test("five-collection limit serializes concurrent creation and 200-icon limit is enforced", async () => {
  await Promise.all(
    Array.from({ length: 4 }, () =>
      collectionStore.create("user_a", "Synthetic"),
    ),
  );
  const attempts = await Promise.allSettled([
    collectionStore.create("user_a", "A"),
    collectionStore.create("user_a", "B"),
  ]);
  assert.equal(
    attempts.filter((result) => result.status === "fulfilled").length,
    1,
  );
  const collection = (await collectionStore.list("user_a"))[0];
  await db.insert(collectionIcons).values(
    Array.from({ length: 200 }, (_, i) => ({
      id: randomUUID(),
      collectionId: collection.id,
      ownerId: "user_a",
      filename: "synthetic.svg",
      source: doc.source,
      hash: `synthetic-${i}`,
    })),
  );
  const result = await collectionStore.upload("user_a", collection.id, [
    { filename: "circle.svg", source: doc.source },
  ]);
  assert.equal(result.results[0].ok, false);
  assert.equal(
    (await collectionStore.page("user_a", collection.id)).icons.length,
    200,
  );
});
test("processing batches are bounded, resume and use at most two simultaneous vision calls", async () => {
  const collection = await fixture("user_a", 7);
  let active = 0,
    max = 0,
    descriptions = 0;
  const bounded: CollectionProviders = {
    ...providers,
    describe: async (...args) => {
      active++;
      max = Math.max(max, active);
      descriptions++;
      await new Promise((resolve) => setTimeout(resolve, 10));
      active--;
      return providers.describe(...args);
    },
  };
  const process = createCollectionProcessor(runDatabase, bounded, render);
  assert.equal((await process("user_a", collection.id, signal())).processed, 5);
  let page = await collectionStore.page("user_a", collection.id);
  assert.equal(page.icons.filter((row) => row.status === "ready").length, 5);
  assert.equal((await process("user_a", collection.id, signal())).processed, 2);
  page = await collectionStore.page("user_a", collection.id);
  assert.equal(page.icons.filter((row) => row.status === "ready").length, 7);
  assert.ok(max <= 2);
  assert.equal(descriptions, 7);
  assert.equal((await process("user_a", collection.id, signal())).processed, 0);
  assert.ok(page.icons.every((row) => row.usage.length === 2));
});
test("concurrent tabs cannot duplicate a provider stage or process another owner's described rows", async () => {
  const collection = await fixture();
  const other = await fixture("user_b");
  await db
    .update(collectionIcons)
    .set({ status: "described", description: "Private other user" })
    .where(eq(collectionIcons.collectionId, other.id));
  let calls = 0;
  const mocked = {
    ...providers,
    describe: async (...args: Parameters<CollectionProviders["describe"]>) => {
      calls++;
      await new Promise((resolve) => setTimeout(resolve, 30));
      return providers.describe(...args);
    },
  };
  const process = createCollectionProcessor(runDatabase, mocked, render);
  const results = await Promise.all([
    process("user_a", collection.id, signal()),
    process("user_a", collection.id, signal()),
  ]);
  assert.equal(
    results.reduce((sum, result) => sum + result.processed, 0),
    1,
  );
  assert.equal(calls, 1);
  assert.equal(
    (await collectionStore.page("user_b", other.id)).icons[0].embeddingAttempts,
    0,
  );
});
test("descriptions persist before failed embeddings and only failed stage is retried three times", async () => {
  const collection = await fixture();
  let visionCalls = 0;
  const failed: CollectionProviders = {
    describe: async (...args) => {
      visionCalls++;
      return providers.describe(...args);
    },
    embed: async () => {
      throw new Error("Secret provider error");
    },
  };
  const process = createCollectionProcessor(runDatabase, failed, render);
  await process("user_a", collection.id, signal());
  let icon = (await collectionStore.page("user_a", collection.id)).icons[0];
  assert.equal(icon.status, "embedding_error");
  assert.ok(icon.description);
  assert.equal(icon.descriptionAttempts, 1);
  assert.equal(icon.embeddingAttempts, 1);
  assert.ok(!icon.error?.includes("Secret"));
  for (let attempt = 2; attempt <= 3; attempt++) {
    await collectionStore.retry("user_a", collection.id, icon.id);
    await process("user_a", collection.id, signal());
  }
  icon = (await collectionStore.page("user_a", collection.id)).icons[0];
  assert.equal(icon.embeddingAttempts, 3);
  assert.equal(visionCalls, 1);
  await assert.rejects(
    () => collectionStore.retry("user_a", collection.id, icon.id),
    /maximum three/,
  );
});
test("description failures require explicit retry and embedding cannot run prematurely", async () => {
  const collection = await fixture();
  let embedCalls = 0;
  const process = createCollectionProcessor(
    runDatabase,
    {
      describe: async () => {
        throw new Error("vision failed");
      },
      embed: async (...args) => {
        embedCalls++;
        return providers.embed(...args);
      },
    },
    render,
  );
  await process("user_a", collection.id, signal());
  const icon = (await collectionStore.page("user_a", collection.id)).icons[0];
  assert.equal(icon.status, "description_error");
  assert.equal(embedCalls, 0);
  assert.equal((await process("user_a", collection.id, signal())).processed, 0);
  await collectionStore.retry("user_a", collection.id, icon.id);
  await processIcons("user_a", collection.id, signal());
  assert.equal(
    (await collectionStore.page("user_a", collection.id)).icons[0].status,
    "ready",
  );
});
test("expired claims need an explicit stage retry and live claims reject retries", async () => {
  const collection = await fixture();
  const icon = (await collectionStore.page("user_a", collection.id)).icons[0];
  await db
    .update(collectionIcons)
    .set({
      claimId: randomUUID(),
      claimExpiresAt: new Date(Date.now() + 60_000),
      descriptionAttempts: 1,
    })
    .where(eq(collectionIcons.id, icon.id));
  assert.equal(
    (await processIcons("user_a", collection.id, signal())).processed,
    0,
  );
  await assert.rejects(
    () => collectionStore.retry("user_a", collection.id, icon.id),
    /being processed/,
  );
  await db
    .update(collectionIcons)
    .set({ claimExpiresAt: new Date(Date.now() - 1000) })
    .where(eq(collectionIcons.id, icon.id));
  assert.equal(
    (await processIcons("user_a", collection.id, signal())).processed,
    0,
  );
  assert.equal(
    (await collectionStore.page("user_a", collection.id)).icons[0].status,
    "description_error",
  );
  await collectionStore.retry("user_a", collection.id, icon.id);
  await processIcons("user_a", collection.id, signal());
  assert.equal(
    (await collectionStore.page("user_a", collection.id)).icons[0]
      .descriptionAttempts,
    2,
  );
});
test("daily analysis and hourly search counters stop provider calls at their limits", async () => {
  const collection = await fixture();
  let calls = 0;
  const process = createCollectionProcessor(
    runDatabase,
    {
      ...providers,
      describe: async (...args) => {
        calls++;
        return providers.describe(...args);
      },
    },
    render,
  );
  await db.insert(collectionUsage).values({
    ownerId: "user_a",
    kind: "analysis",
    window: new Date().toISOString().slice(0, 10),
    count: 200,
  });
  await assert.rejects(
    () => process("user_a", collection.id, signal()),
    /limit reached/,
  );
  assert.equal(calls, 0);
  const search = createOwnedCollectionReferenceRetriever({
    runDatabase,
    providers: {
      ...providers,
      embed: async (...args) => {
        calls++;
        return providers.embed(...args);
      },
    },
  });
  await db.insert(collectionUsage).values({
    ownerId: "user_a",
    kind: "search",
    window: new Date().toISOString().slice(0, 13),
    count: 120,
  });
  await assert.rejects(
    () =>
      search({
        authenticatedUserId: "user_a",
        collectionId: collection.id,
        query: "circle",
        signal: signal(),
      }),
    /limit reached/,
  );
  assert.equal(calls, 0);
});
test("hybrid retrieval filters owners before ranking and generation uses identical playground search", async () => {
  const collection = await fixture("user_a", 3);
  const other = await fixture("user_b", 1);
  await processIcons("user_a", collection.id, signal());
  await processIcons("user_b", other.id, signal());
  // A foreign incompatible vector must not poison this owner's search.
  await db
    .update(collectionIcons)
    .set({ embeddingModel: "foreign-incompatible" })
    .where(eq(collectionIcons.collectionId, other.id));
  const playground = await searchIcons({
    authenticatedUserId: "user_a",
    collectionId: collection.id,
    query: "circle",
    signal: signal(),
  });
  assert.equal(playground.candidates.length, 3);
  assert.ok(
    playground.candidates.every((row) => row.keywordRank && row.semanticRank),
  );
  const conversation = await ragStore.create(
    "user_a",
    randomUUID(),
    "circle",
    collection.id,
  );
  const run = await ragStore.begin(
    "user_a",
    submit(conversation.id, 0, "circle"),
  );
  const generated = await searchIcons({
    authenticatedUserId: "user_a",
    collectionId: collection.id,
    query: "circle",
    signal: signal(),
    assistantMessageId: run.assistantMessageId,
  });
  assert.deepEqual(generated.candidates, playground.candidates);
  assert.equal(generated.references.length, 3);
  const message = applyEvent(
    applyEvent(run.message, { type: "retrieval", detail: generated }),
    { type: "result", message: "Circle", document: doc, usage },
  );
  await ragStore.save("user_a", run, message, true, doc);
  const page = await ragStore.page("user_a", conversation.id);
  const detail = page.messages[1].flow.find(
    (entry) => entry.kind === "retrieval",
  );
  assert.ok(
    detail?.kind === "retrieval" &&
      detail.detail.references[0].source === generated.references[0].source,
  );
  const [stored] = await db
    .select()
    .from(messages)
    .where(eq(messages.id, run.assistantMessageId));
  assert.ok(
    stored.details.flow.every(
      (entry) =>
        entry.kind !== "retrieval" ||
        entry.detail.references.every((ref) => ref.source === null),
    ),
  );
  assert.equal(page.publicId, null);
  const [result] = await db
    .select()
    .from(svgResults)
    .where(eq(svgResults.assistantMessageId, run.assistantMessageId));
  assert.equal(await readPublicSvg(result.id, runDatabase), null);
  assert.equal(await readPublicSvg(result.publicId, runDatabase), null);
  assert.equal(await resolvePublicId(result.id, runDatabase), null);
  await collectionStore.remove(
    "user_a",
    collection.id,
    generated.references[0].iconId,
  );
  const deletedPage = await ragStore.page("user_a", conversation.id);
  const deleted = deletedPage.messages[1].flow.find(
    (entry) => entry.kind === "retrieval",
  );
  assert.ok(
    deleted?.kind === "retrieval" &&
      deleted.detail.references[0].deleted &&
      deleted.detail.references[0].source === null,
  );
  await collectionStore.remove("user_a", collection.id);
  assert.equal(
    (await ragStore.page("user_a", conversation.id)).conversation.private,
    true,
  );
  assert.equal(await readPublicSvg(result.publicId, runDatabase), null);
  assert.ok(
    (await db.select().from(collectionReferences)).every(
      (ref) => ref.source === null,
    ),
  );
});
test("changed embedding model requires explicit reindexing", async () => {
  const collection = await fixture();
  await processIcons("user_a", collection.id, signal());
  const icon = (await collectionStore.page("user_a", collection.id)).icons[0];
  await db
    .update(collectionIcons)
    .set({ embeddingModel: "incompatible" })
    .where(eq(collectionIcons.id, icon.id));
  await assert.rejects(
    () =>
      searchIcons({
        authenticatedUserId: "user_a",
        collectionId: collection.id,
        query: "circle",
        signal: signal(),
      }),
    /Reindex/,
  );
  await collectionStore.retry("user_a", collection.id, icon.id, true);
  await processIcons("user_a", collection.id, signal());
  assert.equal(
    (
      await searchIcons({
        authenticatedUserId: "user_a",
        collectionId: collection.id,
        query: "circle",
        signal: signal(),
      })
    ).candidates.length,
    1,
  );
});
test("feature removal blocks collection runs, empty collections cannot be selected and privacy survives", async () => {
  const empty = await collectionStore.create("user_a", "Empty");
  await assert.rejects(
    () => ragStore.create("user_a", randomUUID(), "Circle", empty.id),
    /searchable icons/,
  );
  const collection = await fixture();
  await processIcons("user_a", collection.id, signal());
  await assert.rejects(
    () => ragStore.create("user_b", randomUUID(), "Circle", collection.id),
    /searchable icons/,
  );
  const denied = createConversationStore(runDatabase, async () => {
    throw new ConversationError("Feature disabled.", 403);
  });
  await assert.rejects(
    () => denied.create("user_a", randomUUID(), "Circle", collection.id),
    /Feature disabled/,
  );
  const conversation = await ragStore.create(
    "user_a",
    randomUUID(),
    "Circle",
    collection.id,
  );
  await assert.rejects(
    () => denied.begin("user_a", submit(conversation.id, 0)),
    /Feature disabled/,
  );
  await collectionStore.remove("user_a", collection.id);
  assert.equal(
    (await denied.page("user_a", conversation.id)).conversation.private,
    true,
  );
});
test("add-from-result revokes all public links permanently and cannot steal or copy an active run", async () => {
  const collection = await fixture();
  const conversation = await create();
  const run = await store.begin("user_a", submit(conversation.id, 0));
  await assert.rejects(
    () => collectionStore.addResult("user_a", collection.id, conversation.id),
    /active generation/,
  );
  await complete(run);
  const page = await store.page("user_a", conversation.id);
  assert.ok(page.publicId);
  await assert.rejects(
    () => collectionStore.addResult("user_b", collection.id, conversation.id),
    notFound,
  );
  await collectionStore.addResult("user_a", collection.id, conversation.id);
  assert.equal(await readPublicSvg(page.publicId, runDatabase), null);
  await collectionStore.remove("user_a", collection.id);
  assert.equal((await store.page("user_a", conversation.id)).publicId, null);
  const followup = await store.begin(
    "user_a",
    submit(conversation.id, 1, "Make it blue"),
  );
  assert.equal(followup.private, true);
  await complete(followup);
  assert.equal((await store.page("user_a", conversation.id)).publicId, null);
});

test("privacy revocation disables old feedback tokens before any external upload", async () => {
  const secret = "x".repeat(32),
    previous = process.env.BRAINTRUST_FEEDBACK_SECRET;
  process.env.BRAINTRUST_FEEDBACK_SECRET = secret;
  try {
    const collection = await fixture();
    const conversation = await create();
    const run = await store.begin("user_a", submit(conversation.id, 0));
    const token = createFeedbackToken("synthetic-span", "user_a", secret);
    await store.save(
      "user_a",
      run,
      applyEvent(run.message, {
        type: "result",
        message: "Circle",
        document: doc,
        usage,
        feedbackToken: token,
      }),
      true,
      doc,
    );
    await collectionStore.addResult("user_a", collection.id, conversation.id);
    let uploaded = false;
    await assert.rejects(
      () =>
        store.saveFeedback(
          "user_a",
          token,
          { token, rating: 1, comment: "Private" },
          async () => {
            uploaded = true;
          },
        ),
      /expired or was not found/,
    );
    assert.equal(uploaded, false);
  } finally {
    if (previous === undefined) delete process.env.BRAINTRUST_FEEDBACK_SECRET;
    else process.env.BRAINTRUST_FEEDBACK_SECRET = previous;
  }
});

test("retrieval query uses the first artwork turn rather than earlier greetings", async () => {
  const collection = await fixture();
  await processIcons("user_a", collection.id, signal());
  const conversation = await ragStore.create(
    "user_a",
    randomUUID(),
    "Hi",
    collection.id,
  );
  const greeting = await ragStore.begin(
    "user_a",
    submit(conversation.id, 0, "Hi"),
  );
  await ragStore.save(
    "user_a",
    greeting,
    applyEvent(greeting.message, {
      type: "reply",
      reason: "conversation",
      message: "Describe your artwork.",
    }),
    true,
  );
  const artwork = await ragStore.begin(
    "user_a",
    submit(conversation.id, 1, "Draw a circle"),
  );
  assert.equal(artwork.initialRequest, "Draw a circle");
  const detail = await searchIcons({
    authenticatedUserId: "user_a",
    collectionId: collection.id,
    query: artwork.initialRequest!,
    signal: signal(),
    assistantMessageId: artwork.assistantMessageId,
  });
  await ragStore.save(
    "user_a",
    artwork,
    applyEvent(applyEvent(artwork.message, { type: "retrieval", detail }), {
      type: "result",
      message: "Circle",
      document: doc,
      usage,
    }),
    true,
    doc,
  );
  const followup = await ragStore.begin(
    "user_a",
    submit(conversation.id, 2, "Make it blue"),
  );
  assert.equal(followup.initialRequest, "Draw a circle");
});
