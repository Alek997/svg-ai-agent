import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { test } from "node:test";
import { stringify } from "yaml";
import { outputHash, parseHumanReviews } from "../evals/human-reviews";
import { reviewRubricVersion } from "../evals/review-artifacts";
import { createReviewHandler } from "../evals/review-server";
import { SyncError } from "../evals/braintrust-reviews";

test("review UI API saves exact-output ratings, preserves other reviews and rejects stale or cross-origin writes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "review-server-"));
  const source =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="3"/></svg>';
  const entry = {
    case: "circle",
    output_sha256: outputHash(source),
    quality: null,
    acceptable: null,
    problems: [],
    notes: "",
    skipped: false,
  };
  try {
    await writeFile(
      join(directory, "results.json"),
      JSON.stringify({
        results: ["circle", "other"].map((id) => ({
          input: {
            id,
            tags: [],
            input: { messages: [{ role: "user", content: "Draw a circle" }] },
            expected: { requirements: ["Circle"] },
          },
          output: { status: "completed", source },
        })),
      }),
    );
    await writeFile(
      join(directory, "human-reviews.yaml"),
      stringify({
        rubric_version: reviewRubricVersion,
        reviewer: "",
        reviews: [
          entry,
          { ...entry, problems: [], case: "other", notes: "Keep this" },
        ],
      }),
    );
    let syncCalls = 0;
    let failSync = false;
    const handler = createReviewHandler({
      directories: new Map([["test", directory]]),
      pages: new Map([["/test", '<meta content="__REVIEW_TOKEN__">']]),
      origin: "http://127.0.0.1:4318",
      token: "test-token",
      sync: async (target, revision) => {
        assert.equal(target, directory);
        assert.ok(revision);
        syncCalls++;
        if (failSync) throw new SyncError("Sync unavailable. Try again.");
        return {
          count: 2,
          qualityRated: 0,
          acceptableRated: 0,
          revision: revision!,
        };
      },
    });
    async function request(
      method: string,
      body?: unknown,
      headers: Record<string, string> = {},
      path = "/api/reviews/test",
    ) {
      const req = Object.assign(
        Readable.from(body === undefined ? [] : [JSON.stringify(body)]),
        {
          method,
          url: path,
          headers: {
            host: "127.0.0.1:4318",
            origin: "http://127.0.0.1:4318",
            "content-type": "application/json",
            "x-review-token": "test-token",
            ...headers,
          },
        },
      ) as unknown as IncomingMessage;
      let status = 0,
        text = "";
      const res = {
        writeHead(code: number) {
          status = code;
        },
        end(value: string) {
          text = value;
        },
      } as unknown as ServerResponse;
      await handler(req, res);
      return { status, text, json: () => JSON.parse(text) };
    }
    const loaded = (await request("GET")).json();
    const payload = {
      revision: loaded.revision,
      reviewer: "Human",
      review: {
        ...entry,
        quality: 4,
        acceptable: false,
        notes: "Visible problem",
      },
    };
    assert.equal(
      (await request("POST", payload, { origin: "https://untrusted.example" }))
        .status,
      403,
    );
    assert.equal(
      (await request("POST", payload, { "x-review-token": "wrong" })).status,
      403,
    );
    assert.equal(
      (await request("POST", payload, { host: "other.example" })).status,
      403,
    );
    assert.equal(
      (
        await request("POST", {
          ...payload,
          review: { ...payload.review, output_sha256: "a".repeat(64) },
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await request("POST", {
          ...payload,
          review: { ...payload.review, quality: 6 },
        })
      ).status,
      400,
    );
    assert.equal((await request("POST", payload)).status, 200);
    const saved = parseHumanReviews(
      await readFile(join(directory, "human-reviews.yaml"), "utf8"),
    );
    assert.equal(saved.reviews[0].quality, 4);
    assert.equal(saved.reviews[0].acceptable, false);
    assert.equal(saved.reviews[1].notes, "Keep this");
    assert.equal((await request("POST", payload)).status, 409);
    const refreshed = (await request("GET")).json();
    assert.equal(refreshed.document.reviews[0].quality, 4);
    const clear = {
      ...payload,
      revision: refreshed.revision,
      review: { ...entry, skipped: true },
    };
    assert.equal((await request("POST", clear)).status, 200);
    const cleared = (await request("GET")).json().document.reviews[0];
    assert.equal(cleared.quality, null);
    assert.equal(cleared.acceptable, null);
    assert.equal(
      (await request("GET", undefined, {}, "/api/reviews/../test")).status,
      404,
    );
    assert.ok(
      (await request("GET", undefined, {}, "/test")).text.includes(
        "test-token",
      ),
    );
    const syncPath = "/api/reviews/test/sync";
    const revision = (await request("GET")).json().revision;
    assert.equal((await request("GET", undefined, {}, syncPath)).status, 405);
    assert.equal(
      (
        await request(
          "POST",
          { revision },
          { origin: "https://untrusted.example" },
          syncPath,
        )
      ).status,
      403,
    );
    assert.equal(
      (await request("POST", { revision: loaded.revision }, {}, syncPath))
        .status,
      409,
    );
    assert.equal(syncCalls, 0);
    const synced = await request("POST", { revision }, {}, syncPath);
    assert.equal(synced.status, 200);
    assert.equal(synced.json().count, 2);
    assert.equal(syncCalls, 1);
    failSync = true;
    const failed = await request("POST", { revision }, {}, syncPath);
    assert.equal(failed.status, 502);
    assert.equal(failed.json().error, "Sync unavailable. Try again.");
    assert.equal((await request("GET")).json().revision, revision);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
