// Loopback-only E2E host, never mounted in Next.js. Credentials are used only in explicitly approved live mode.
import { createServer } from "node:http";
import { readFile, readdir } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import { build } from "esbuild";
import { z } from "zod";
import { FixtureConversationStore } from "./conversation-store";
import { handleSavedSvgGenerationOnServer } from "../../../lib/conversations/generate";
import { createConversationSchema } from "../../../lib/conversations/contracts";
import {
  conversationErrorResponse,
  jsonResponse,
  readJson,
} from "../../../lib/conversations/http";
import type { ServerSvgGenerator } from "../../../lib/ai/handle-generation";
import { safeSvgSchema } from "../../../lib/svg/validate-svg";

const liveMode = process.env.E2E_LIVE_MODE === "1";
const port = liveMode ? 4322 : 4321;
const host = `http://127.0.0.1:${port}`;
const live = liveMode
  ? (await import("../live/generator")).createBoundedLiveGenerator()
  : null;
let liveSubmissionConsumed = false;
const owner = "playwright-fixture-owner";
const store = new FixtureConversationStore();
const scenarioSchema = z
  .object({
    mode: z.enum([
      "success",
      "reject-request",
      "fail-generation",
      "unsafe-result",
      "lost-result",
      "hold-generation",
      "fail-confirmation",
      "conversation-reply",
      "conflict",
    ]),
  })
  .strict();
type Scenario = z.infer<typeof scenarioSchema>["mode"];
let nextScenario: Scenario = "success";
let releaseGeneration: (() => void) | null = null;
let failPageLoads = false;
let generationCalls = 0;
let cancelledGenerations = 0;
let submissions: unknown[] = [];
const usage = {
  model: "synthetic",
  inputTokens: 10,
  outputTokens: 20,
  cachedInputTokens: 0,
  totalTokens: 30,
};
const circle = (edited: boolean) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><circle cx="60" cy="60" r="40" fill="${edited ? "#8b5cf6" : "#f59e0b"}"/></svg>`;
const generator =
  (mode: Scenario, number: number): ServerSvgGenerator =>
  async (input, signal, progress, event) => {
    const source = circle(!!input.currentSvg);
    progress(source.length);
    event?.({ type: "activity", step: 1, action: "validateSvg" });
    event?.({ type: "preview", svg: safeSvgSchema.parse(source) });
    try {
      if (mode === "hold-generation") {
        await Promise.race([
          new Promise<void>((resolve) => {
            releaseGeneration = resolve;
          }),
          delay(60_000, undefined, { signal }),
        ]);
        signal.throwIfAborted();
      } else await delay(1100, undefined, { signal });
    } catch (error) {
      if (signal.aborted) cancelledGenerations++;
      throw error;
    }
    if (mode === "fail-generation")
      throw new Error("Synthetic provider failure");
    if (mode === "fail-confirmation") failPageLoads = true;
    return {
      output: {
        message: input.currentSvg
          ? "Updated the circle to purple."
          : "Created an amber circle.",
        filename: `circle-${number}.svg`,
        svg:
          mode === "unsafe-result"
            ? '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 120"><script>alert(1)</script></svg>'
            : source,
      },
      usage,
    };
  };
const bundle = await build({
  entryPoints: ["tests/e2e/fixture/client.tsx"],
  bundle: true,
  write: false,
  platform: "browser",
  jsx: "automatic",
  alias: {
    "next/navigation": `${process.cwd()}/tests/browser/navigation.ts`,
    "next/link": `${process.cwd()}/tests/browser/link.tsx`,
  },
  define: { "process.env.NODE_ENV": '"development"' },
});
let css: string;
try {
  const files = await readdir(".next/static/css");
  css = (
    await Promise.all(
      files
        .filter((file) => file.endsWith(".css"))
        .map((file) => readFile(`.next/static/css/${file}`, "utf8")),
    )
  ).join("\n");
} catch {
  throw new Error("Build the app CSS first: npm run build -- --webpack");
}
const html = `<!doctype html><html><head><title>SVG Studio E2E workspace</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body style="font-family:Arial,sans-serif"><div id="root" data-generation-mode="${live ? "paid" : "synthetic"}"></div><script src="/client.js"></script></body></html>`;

async function route(request: Request) {
  const url = new URL(request.url);
  if (url.pathname === "/client.js")
    return new Response(Buffer.from(bundle.outputFiles[0].contents), {
      headers: { "Content-Type": "text/javascript" },
    });
  if (
    live &&
    url.pathname.startsWith("/__fixture/") &&
    request.method !== "GET"
  )
    return jsonResponse({ error: "Live smoke controls are locked." }, 403);
  if (url.pathname === "/__fixture/reset" && request.method === "POST") {
    releaseGeneration?.();
    releaseGeneration = null;
    store.reset();
    nextScenario = "success";
    failPageLoads = false;
    generationCalls = 0;
    cancelledGenerations = 0;
    submissions = [];
    return jsonResponse({ ok: true });
  }
  if (url.pathname === "/__fixture/scenario" && request.method === "POST") {
    nextScenario = (await readJson(request, scenarioSchema)).mode;
    return jsonResponse({ ok: true });
  }
  if (url.pathname === "/__fixture/release" && request.method === "POST") {
    releaseGeneration?.();
    releaseGeneration = null;
    return jsonResponse({ ok: true });
  }
  if (url.pathname === "/__fixture/state")
    return jsonResponse({
      generationCalls,
      cancelledGenerations,
      submissions,
      ...live?.stats(),
    });
  if (url.pathname === "/api/conversations") {
    if (request.method === "GET") return jsonResponse(store.list(owner));
    const body = await readJson(request, createConversationSchema);
    const saved = store.create(owner, body.requestId, body.content);
    return jsonResponse({
      id: saved.id,
      title: saved.title,
      updatedAt: saved.updatedAt,
      revision: saved.revision,
    });
  }
  if (url.pathname.startsWith("/api/conversations/")) {
    if (failPageLoads)
      return jsonResponse({ error: "Synthetic saved state unavailable." }, 503);
    return jsonResponse(
      store.page(
        owner,
        url.pathname.split("/")[3],
        Number(url.searchParams.get("before")) || undefined,
      ),
    );
  }
  if (url.pathname === "/api/generate") {
    if (live && liveSubmissionConsumed)
      return jsonResponse(
        { error: "Live smoke permits one browser submission only." },
        402,
      );
    if (live) liveSubmissionConsumed = true;
    const mode = nextScenario;
    nextScenario = "success";
    generationCalls++;
    submissions.push(await request.clone().json());
    if (mode === "reject-request" || mode === "conflict")
      return jsonResponse(
        { error: "Synthetic request could not be accepted." },
        mode === "conflict" ? 409 : 503,
      );
    const response = await handleSavedSvgGenerationOnServer({
      request,
      authenticatedUserId: owner,
      generateSvgWithoutCollectionReferences:
        live?.generate ?? generator(mode, generationCalls),
      generationDependencies: {
        store,
        ...(live ? { timeoutMs: 90_000 } : {}),
        checkGenerationPolicy: async () =>
          mode === "conversation-reply"
            ? {
                kind: "reply",
                reason: "conversation",
                message: "You're welcome!",
              }
            : { kind: "generation" },
      },
    });
    if (mode !== "lost-result" || !response.body) return response;
    // The saved handler enqueues one complete NDJSON record per chunk. Omit only delivery of the result, after its real save.
    return new Response(
      response.body.pipeThrough(
        new TransformStream<Uint8Array, Uint8Array>({
          transform(record, controller) {
            if (JSON.parse(new TextDecoder().decode(record)).type !== "result")
              controller.enqueue(record);
          },
        }),
      ),
      { status: response.status, headers: response.headers },
    );
  }
  if (url.pathname.startsWith("/api/"))
    return jsonResponse({ error: "Unknown fixture route" }, 404);
  return new Response(html, { headers: { "Content-Type": "text/html" } });
}
const server = createServer(async (incoming, outgoing) => {
  const chunks: Buffer[] = [];
  for await (const chunk of incoming) chunks.push(chunk);
  const cancellation = new AbortController();
  outgoing.on("close", () => {
    if (!outgoing.writableEnded) cancellation.abort();
  });
  try {
    const request = new Request(`${host}${incoming.url}`, {
      method: incoming.method,
      headers: incoming.headers as Record<string, string>,
      ...(chunks.length ? { body: Buffer.concat(chunks) } : {}),
      signal: cancellation.signal,
    });
    const response = await route(request).catch((error) =>
      conversationErrorResponse(error),
    );
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    const reader = response.body?.getReader();
    if (reader) {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!outgoing.destroyed) outgoing.write(value);
      }
    }
    if (!outgoing.destroyed) outgoing.end();
  } catch (error) {
    if (!cancellation.signal.aborted) console.error(error);
    outgoing.destroy();
  }
});
server.listen(port, "127.0.0.1", () =>
  console.log(`Workspace E2E fixture: ${host}`),
);
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => server.close(() => process.exit()));
