import { randomBytes } from "node:crypto";
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { resolve } from "node:path";
import { stringify } from "yaml";
import { z } from "zod";
import {
  humanReviewsSchema,
  outputHash,
  parseHumanReviews,
} from "./human-reviews";
import { savedRunSchema } from "./review-artifacts";
import { reviewClient } from "./review-client";
import { syncHumanReviews, SyncError } from "./braintrust-reviews";

class ReviewError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

const saveSchema = z
  .object({
    revision: z.string().regex(/^[a-f0-9]{64}$/),
    reviewer: z.string().trim().max(200),
    review: humanReviewsSchema.shape.reviews.element,
  })
  .strict();

export function createReviewHandler({
  directories,
  pages,
  origin,
  token = randomBytes(32).toString("hex"),
  sync = syncHumanReviews,
}: {
  directories: Map<string, string>;
  pages: Map<string, string>;
  origin: string;
  token?: string;
  sync?: typeof syncHumanReviews;
}) {
  // Serialize read/modify/write per run; stale browser tabs get a conflict.
  const queues = new Map<string, Promise<void>>();
  const syncing = new Set<string>();
  return async (request: IncomingMessage, response: ServerResponse) => {
    const send = (
      status: number,
      value: unknown,
      type = "application/json",
    ) => {
      response.writeHead(status, {
        "Content-Type": type + "; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy":
          "default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
      });
      response.end(type === "application/json" ? JSON.stringify(value) : value);
    };
    try {
      if (request.headers.host !== new URL(origin).host)
        throw new ReviewError("Invalid host.", 403);
      const path = request.url ?? "";
      if (request.method === "GET" && path === "/review.js") {
        send(200, reviewClient, "text/javascript");
        return;
      }
      if (request.method === "GET" && pages.has(path)) {
        send(
          200,
          pages.get(path)!.replace("__REVIEW_TOKEN__", token),
          "text/html",
        );
        return;
      }
      const isSync = path.endsWith("/sync");
      const name = path.startsWith("/api/reviews/")
        ? path.slice(
            "/api/reviews/".length,
            isSync ? -"/sync".length : undefined,
          )
        : "";
      const directory = directories.get(name);
      if (!directory) throw new ReviewError("Review run not found.", 404);
      const file = resolve(directory, "human-reviews.yaml");
      const load = async () => {
        const text = await readFile(file, "utf8");
        return {
          document: parseHumanReviews(text),
          revision: outputHash(text),
        };
      };
      if (request.method === "GET") {
        if (isSync)
          throw new ReviewError(
            "Use the sync button to upload saved reviews.",
            405,
          );
        send(200, await load());
        return;
      }
      if (request.method !== "POST")
        throw new ReviewError("Method not allowed.", 405);
      if (
        request.headers.origin !== origin ||
        request.headers["x-review-token"] !== token
      )
        throw new ReviewError("Refresh the review page before saving.", 403);
      if (request.headers["content-type"]?.split(";")[0] !== "application/json")
        throw new ReviewError("Send JSON.", 415);
      let size = 0;
      const chunks: Buffer[] = [];
      for await (const chunk of request) {
        const bytes = Buffer.from(chunk);
        size += bytes.length;
        if (size > 64_000) throw new ReviewError("Review is too large.", 413);
        chunks.push(bytes);
      }
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      if (isSync) {
        const payload = z
          .object({ revision: z.string().regex(/^[a-f0-9]{64}$/) })
          .strict()
          .safeParse(body);
        if (!payload.success)
          throw new ReviewError("Reload the page before syncing.", 400);
        if (syncing.has(name))
          throw new ReviewError(
            "This run is already syncing. Wait for it to finish.",
            409,
          );
        syncing.add(name);
        const operation = (queues.get(name) ?? Promise.resolve())
          .catch(() => {})
          .then(async () => {
            const current = await load();
            if (current.revision !== payload.data.revision)
              throw new ReviewError(
                "Reviews changed in another tab or editor. Reload before syncing.",
                409,
              );
            send(200, await sync(directory, current.revision));
          });
        queues.set(
          name,
          operation.catch(() => {}),
        );
        try {
          await operation;
        } finally {
          syncing.delete(name);
        }
        return;
      }
      const parsed = saveSchema.safeParse(body);
      if (!parsed.success)
        throw new ReviewError(
          "Invalid ratings. Use quality 1–5 or N/A; notes up to 5000 characters.",
          400,
        );
      const payload = parsed.data;
      const previous = queues.get(name) ?? Promise.resolve();
      const operation = previous
        .catch(() => {})
        .then(async () => {
          const current = await load();
          if (current.revision !== payload.revision)
            throw new ReviewError(
              "Reviews changed in another tab or editor. Reload the page before saving; copy your unsaved notes first.",
              409,
            );
          const run = savedRunSchema.parse(
            JSON.parse(
              await readFile(resolve(directory, "results.json"), "utf8"),
            ),
          );
          const matches = run.results.filter(
            (row) => row.input.id === payload.review.case,
          );
          const row = matches[0];
          if (
            matches.length !== 1 ||
            row.output?.status !== "completed" ||
            !row.output.source ||
            outputHash(row.output.source) !== payload.review.output_sha256
          )
            throw new ReviewError(
              "The SVG changed. Refresh the gallery before reviewing.",
              409,
            );
          const reviews = current.document.reviews.filter(
            (review) => review.case !== payload.review.case,
          );
          const position = current.document.reviews.findIndex(
            (review) => review.case === payload.review.case,
          );
          reviews.splice(
            position < 0 ? reviews.length : position,
            0,
            payload.review,
          );
          const document = humanReviewsSchema.safeParse({
            ...current.document,
            reviewer: payload.reviewer,
            reviews,
          });
          if (!document.success)
            throw new ReviewError(
              "Enter a reviewer name for scored reviews; skipped reviews must have N/A ratings.",
              400,
            );
          const text = stringify(document.data, {
            aliasDuplicateObjects: false,
          });
          const temporary =
            file + "." + randomBytes(8).toString("hex") + ".tmp";
          try {
            await writeFile(temporary, text, { flag: "wx" });
            await rename(temporary, file);
          } finally {
            await rm(temporary, { force: true });
          }
          send(200, { document: document.data, revision: outputHash(text) });
        });
      queues.set(
        name,
        operation.catch(() => {}),
      );
      await operation;
    } catch (error) {
      send(
        error instanceof ReviewError
          ? error.status
          : error instanceof SyncError
            ? 502
            : 400,
        {
          error:
            error instanceof ReviewError || error instanceof SyncError
              ? error.message
              : "Could not load or save this review. Check that the review file is valid YAML and try again.",
        },
      );
    }
  };
}
