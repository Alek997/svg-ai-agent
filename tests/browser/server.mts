// Never mounted in Next.js. Loopback-only manual QA with a disposable database.
import { createServer } from "node:http";
import { readFile, readdir } from "node:fs/promises";
import { build } from "esbuild";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { z } from "zod";
import { createCollectionStore } from "../../lib/collections/store";
import { createCollectionProcessor } from "../../lib/collections/process";
import {
  createOwnedCollectionReferenceRetriever,
  buildCollectionRetrievalQuery,
} from "../../lib/collections/retrieval";
import { createConversationStore } from "../../lib/conversations/store";
import { handleSavedSvgGenerationOnServer } from "../../lib/conversations/generate";
import { createConversationSchema } from "../../lib/conversations/contracts";
import {
  conversationErrorResponse,
  jsonResponse,
  readJson,
} from "../../lib/conversations/http";
import { publicSvgResponse, readPublicSvg } from "../../lib/svg/public-result";
import type { withDatabase } from "../../lib/db/client";
import type { CollectionProviders } from "../../lib/collections/providers";
import type { ServerSvgGenerator } from "../../lib/ai/handle-generation";
import type { Retrieval } from "../../lib/collections/contracts";
const connectionString = process.env.TEST_DATABASE_URL;
if (
  !connectionString ||
  !new URL(connectionString).pathname.startsWith("/svg_conversations_test")
)
  throw new Error(
    "Use a disposable svg_conversations_test* database, migrated with test:db first.",
  );
const pool = new Pool({ connectionString });
const db = drizzle(pool);
const runDatabase: typeof withDatabase = async (action) =>
  action(db as unknown as Parameters<Parameters<typeof withDatabase>[0]>[0]);
const collections = createCollectionStore(runDatabase),
  conversations = createConversationStore(runDatabase, async () => {});
const owner = "browser-fixture-owner";
let failEmbedding = false,
  failGeneration = false,
  invalidSvg = false;
const usage = {
  model: "mock",
  inputTokens: 10,
  outputTokens: 20,
  cachedInputTokens: 0,
  totalTokens: 30,
};
const providers: CollectionProviders = {
  describe: async () => {
    await new Promise((resolve) => setTimeout(resolve, 500));
    return {
      description: "Synthetic outline circle",
      tags: ["circle", "round", "outline"],
      usage,
    };
  },
  embed: async (values, signal) => {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    signal.throwIfAborted();
    if (failEmbedding) {
      failEmbedding = false;
      throw new Error("Mock embedding failure");
    }
    return {
      embeddings: values.map(() => [1, ...Array(1535).fill(0)]),
      usage: {
        model: "text-embedding-3-small",
        tokens: values.length * 5,
        dimensions: 1536,
      },
    };
  },
};
const processCollection = createCollectionProcessor(runDatabase, providers),
  search = createOwnedCollectionReferenceRetriever({
    runDatabase,
    providers,
  });
const source =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="black" stroke-width="2"><circle cx="12" cy="12" r="8"/></svg>';
const generate =
  (references?: Retrieval): ServerSvgGenerator =>
  async (_input, signal, progress, event) => {
    const drawing = references?.references[0]?.source ?? source;
    progress(100);
    event?.({
      type: "preview",
      svg: { source: drawing, width: 24, height: 24 },
    });
    await new Promise((resolve) => setTimeout(resolve, 700));
    signal.throwIfAborted();
    const svg = invalidSvg ? "<svg><script/></svg>" : drawing;
    invalidSvg = false;
    return {
      output: {
        message: "Mocked circle generated using the selected references.",
        filename: "synthetic-circle.svg",
        svg,
      },
      usage,
    };
  };
await build({
  entryPoints: ["tests/browser/client.tsx"],
  outfile: "/tmp/svg-rag-browser-client.js",
  bundle: true,
  platform: "browser",
  jsx: "automatic",
  alias: { "next/navigation": `${process.cwd()}/tests/browser/navigation.ts` },
  define: { "process.env.NODE_ENV": '"development"' },
});
const cssDirectory = ".next/static/css";
const css = (
  await Promise.all(
    (await readdir(cssDirectory))
      .filter((file) => file.endsWith(".css"))
      .map((file) => readFile(`${cssDirectory}/${file}`, "utf8")),
  )
).join("\n");
const html =
  '<!doctype html><html><head><title>Collections synthetic QA</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>' +
  css +
  '</style></head><body><div id="root"></div><script src="/client.js"></script></body></html>';
async function route(request: Request) {
  const url = new URL(request.url),
    path = url.pathname;
  if (path === "/client.js")
    return new Response(await readFile("/tmp/svg-rag-browser-client.js"), {
      headers: { "Content-Type": "text/javascript" },
    });
  if (path.startsWith("/__fixture/")) {
    if (path.endsWith("fail-embedding")) failEmbedding = true;
    if (path.endsWith("fail-generation")) failGeneration = true;
    if (path.endsWith("invalid-svg")) invalidSvg = true;
    return jsonResponse({ ok: true });
  }
  if (path === "/api/collections")
    return request.method === "GET"
      ? jsonResponse({ collections: await collections.list(owner) })
      : jsonResponse(
          await collections.create(
            owner,
            (
              await readJson(
                request,
                z.object({ name: z.string().min(1).max(80) }),
              )
            ).name,
          ),
        );
  if (path.startsWith("/api/collections/")) {
    const [, , , id, action] = path.split("/");
    if (request.method === "DELETE") {
      await collections.remove(owner, id);
      return jsonResponse({ deleted: true });
    }
    if (!action) return jsonResponse(await collections.page(owner, id));
    const body = await request.json();
    if (action === "upload")
      return jsonResponse(await collections.upload(owner, id, body.files));
    if (action === "process")
      return jsonResponse(await processCollection(owner, id, request.signal));
    if (action === "retry") {
      await collections.retry(owner, id, body.iconId, body.reindex);
      return jsonResponse({ retried: true });
    }
    if (action === "search")
      return jsonResponse(
        await search({
          authenticatedUserId: owner,
          collectionId: id,
          query: body.query,
          signal: request.signal,
        }),
      );
    if (action === "add-result")
      return jsonResponse(
        await collections.addResult(owner, id, body.conversationId),
      );
    if (action === "delete-icon") {
      await collections.remove(owner, id, body.iconId);
      return jsonResponse({ deleted: true });
    }
  }
  if (path === "/api/conversations") {
    if (request.method === "GET")
      return jsonResponse(await conversations.list(owner));
    const body = await readJson(request, createConversationSchema);
    return jsonResponse(
      await conversations.create(
        owner,
        body.requestId,
        body.content,
        body.collectionId,
      ),
    );
  }
  if (path.startsWith("/api/conversations/"))
    return jsonResponse(await conversations.page(owner, path.split("/")[3]));
  if (path.startsWith("/api/public/svgs/"))
    return publicSvgResponse(path.split("/")[4], (id) =>
      readPublicSvg(id, runDatabase),
    );
  if (path === "/api/generate") {
    if (failGeneration) {
      failGeneration = false;
      return jsonResponse({ error: "Mocked unavailable request. Retry." }, 503);
    }
    return handleSavedSvgGenerationOnServer({
      request,
      authenticatedUserId: owner,
      generateSvgWithoutCollectionReferences: generate(),
      generationDependencies: {
        store: conversations,
        checkGenerationPolicy: async () => ({ kind: "generation" }),
        retrieveCollectionReferencesForRun: ({
          startedConversationRun: run,
          svgGenerationRequest: input,
          signal,
        }) =>
          search({
            authenticatedUserId: owner,
            collectionId: run.collectionId!,
            query: buildCollectionRetrievalQuery({
              initialArtworkRequest: run.initialRequest!,
              latestUserMessage: input.messages.at(-1)!.content,
            }),
            signal,
            assistantMessageId: run.assistantMessageId,
          }),
        generateSvgWithCollectionReferences: ({
          svgGenerationRequest: input,
          signal,
          onProgress: progress,
          onEvent: event,
          collectionRetrievalContext: detail,
        }) => generate(detail)(input, signal, progress, event),
      },
    });
  }
  return new Response(html, { headers: { "Content-Type": "text/html" } });
}
const server = createServer(async (incoming, outgoing) => {
  const chunks = [];
  for await (const chunk of incoming) chunks.push(chunk);
  const controller = new AbortController();
  outgoing.on("close", () => {
    if (!outgoing.writableEnded) controller.abort();
  });
  const request = new Request(`http://127.0.0.1:4317${incoming.url}`, {
    method: incoming.method,
    headers: incoming.headers as Record<string, string>,
    ...(chunks.length ? { body: Buffer.concat(chunks) } : {}),
    signal: controller.signal,
  });
  let response: Response;
  try {
    response = await route(request);
  } catch (error) {
    response = conversationErrorResponse(error);
  }
  outgoing.writeHead(response.status, Object.fromEntries(response.headers));
  const reader = response.body?.getReader();
  if (reader) {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      outgoing.write(value);
    }
  }
  outgoing.end();
});
server.listen(4317, "127.0.0.1", () =>
  console.log("Synthetic browser fixture at http://127.0.0.1:4317/collections"),
);
for (const event of ["SIGINT", "SIGTERM"] as const)
  process.on(event, () => {
    server.close();
    void pool.end().then(() => process.exit());
  });
