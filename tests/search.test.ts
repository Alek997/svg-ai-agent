import assert from "node:assert/strict";
import { test } from "node:test";
import { createWebSearch } from "../lib/ai/web-search";
import {
  searchInputSchema,
  searchSourceSchema,
  toolTraceSchema,
} from "../lib/workspace/contracts";

const input = { query: "new character visual description" };
const options = { toolCallId: "search", messages: [], context: {} };
const source = {
  title: "Character reference",
  url: "https://example.com/reference",
  content: "A blue character wearing a red hat.",
};
const run = (
  search: ReturnType<typeof createWebSearch>,
  signal?: AbortSignal,
) => search.tool.execute!(input, { ...options, abortSignal: signal });

test("search validates queries, time filters and safe source URLs", () => {
  for (const query of ["", " ", "x".repeat(401)])
    assert.equal(searchInputSchema.safeParse({ query }).success, false);
  assert.equal(
    searchInputSchema.safeParse({ ...input, timeRange: "month" }).success,
    true,
  );
  assert.equal(
    searchInputSchema.safeParse({ ...input, timeRange: "all" }).success,
    false,
  );
  for (const url of [
    "javascript:alert(1)",
    "data:text/html,bad",
    "https://secret:password@example.com",
  ]) {
    assert.equal(
      searchSourceSchema.safeParse({ ...source, url }).success,
      false,
    );
  }
});

test("search fixes provider cost settings and bounds, deduplicates and validates results", async () => {
  let calls = 0;
  const search = createWebSearch({
    apiKey: "test-key",
    fetcher: async (url, init) => {
      calls++;
      assert.equal(url, "https://api.tavily.com/search");
      assert.equal(
        new Headers(init?.headers).get("authorization"),
        "Bearer test-key",
      );
      const body = JSON.parse(String(init?.body));
      assert.equal(body.search_depth, "basic");
      assert.equal(body.max_results, 5);
      assert.equal(body.auto_parameters, false);
      assert.equal(body.include_images, false);
      assert.equal(body.time_range, "month");
      return Response.json({
        results: [
          { ...source, content: "x".repeat(5000) },
          source,
          { ...source, url: "javascript:alert(1)" },
          ...Array.from({ length: 10 }, (_, i) => ({
            ...source,
            url: `https://example.com/${i}`,
          })),
        ],
        api_key: "DO_NOT_FORWARD",
      });
    },
  });
  const result = await search.tool.execute!(
    { ...input, timeRange: "month" },
    options,
  );
  const parsed = toolTraceSchema.parse({
    id: "search",
    name: "webSearch",
    step: 1,
    status: "completed",
    output: result,
  });
  assert.ok(parsed.output && "ok" in parsed.output && parsed.output.ok);
  assert.equal(parsed.output.results.length, 5);
  assert.equal(parsed.output.results[0].content.length, 1500);
  assert.equal(calls, 1);
  assert.doesNotMatch(JSON.stringify(result), /DO_NOT_FORWARD|test-key/);
});

test("parallel searches share a two-attempt budget and each request owns its budget", async () => {
  let calls = 0;
  const config = {
    apiKey: "test-key",
    fetcher: async () => {
      calls++;
      return Response.json({ results: [] });
    },
  };
  const search = createWebSearch(config);
  const results = await Promise.all([
    run(search),
    run(search),
    run(search),
    run(search),
  ]);
  assert.equal(calls, 2);
  assert.equal(search.hasBudget(), false);
  assert.match(JSON.stringify(results[2]), /budget exhausted/);
  await run(createWebSearch(config));
  assert.equal(calls, 3);
});

test("missing credentials do not call the provider", async () => {
  const search = createWebSearch({
    apiKey: "",
    fetcher: async () => {
      throw new Error("Must not call");
    },
  });
  assert.match(JSON.stringify(await run(search)), /not configured/);
});

for (const [name, fetcher] of [
  [
    "provider error",
    async () => new Response("SECRET provider internals", { status: 401 }),
  ],
  ["malformed JSON", async () => new Response("SECRET")],
  [
    "malformed results",
    async () => Response.json({ results: [{ title: "bad" }] }),
  ],
  ["oversized response", async () => new Response("x".repeat(100_001))],
  [
    "network failure",
    async () => {
      throw new Error("SECRET provider internals");
    },
  ],
] as const) {
  test(`search redacts ${name} and consumes an attempt`, async () => {
    const search = createWebSearch({ apiKey: "SECRET", fetcher });
    const result = await run(search);
    assert.match(JSON.stringify(result), /unavailable/);
    assert.doesNotMatch(JSON.stringify(result), /SECRET|internals/);
    await run(search);
    assert.equal(search.hasBudget(), false);
  });
}

test("search timeout and request cancellation abort the fetch", async () => {
  const fetcher: typeof fetch = async (_, init) =>
    new Promise((_, reject) => {
      const signal = init?.signal;
      if (signal?.aborted) reject(new Error("aborted"));
      else
        signal?.addEventListener("abort", () => reject(new Error("aborted")), {
          once: true,
        });
    });
  assert.match(
    JSON.stringify(
      await run(createWebSearch({ apiKey: "test", fetcher, timeoutMs: 5 })),
    ),
    /timed out/,
  );
  const controller = new AbortController();
  const pending = run(
    createWebSearch({ apiKey: "test", fetcher }),
    controller.signal,
  );
  controller.abort();
  assert.match(JSON.stringify(await pending), /cancelled/);
});
