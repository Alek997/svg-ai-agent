import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { publicSvgResponse } from "../lib/svg/public-result";
import { publicIdSchema } from "../lib/svg/public-id";

const source =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="30"/></svg>';

test("public SVG response returns only validated markup with generic filename and no caching", async () => {
  const response = await publicSvgResponse("K7m2pR9xBc_A", async () => source);
  assert.equal(response.status, 200);
  assert.equal(await response.text(), source);
  assert.match(response.headers.get("Content-Type")!, /image\/svg\+xml/);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.equal(
    response.headers.get("Content-Disposition"),
    'inline; filename="artwork.svg"',
  );
  assert.match(response.headers.get("Content-Security-Policy")!, /sandbox/);
});

test("short identifiers accept only twelve URL-safe characters", () => {
  assert.equal(publicIdSchema.safeParse("K7m2pR9xBc_A").success, true);
  for (const id of [
    "too-short",
    "a".repeat(13),
    "a".repeat(11) + "/",
    "a".repeat(11) + "=",
    "a".repeat(11) + " ",
  ]) {
    assert.equal(publicIdSchema.safeParse(id).success, false);
  }
});

test("legacy UUID identifiers continue to serve validated SVGs", async () => {
  const response = await publicSvgResponse(randomUUID(), async () => source);
  assert.equal(response.status, 200);
  assert.equal(await response.text(), source);
});

test("invalid public IDs do not query storage", async () => {
  const response = await publicSvgResponse("not-a-uuid", async () => {
    throw new Error("Must not query");
  });
  assert.equal(response.status, 404);
});

test("missing, deleted and unsafe SVGs share the same generic unavailable response", async () => {
  for (const value of [
    null,
    "<svg><script/></svg>",
    { source, owner: "private-user", prompt: "private-prompt" },
  ]) {
    const response = await publicSvgResponse(randomUUID(), async () => value);
    assert.equal(response.status, 404);
    assert.equal(await response.text(), "SVG unavailable.");
  }
});

test("public storage failures expose no internal information and permit retry", async () => {
  const response = await publicSvgResponse(randomUUID(), async () => {
    throw new Error("private database connection secret");
  });
  assert.equal(response.status, 503);
  assert.equal(
    await response.text(),
    "SVG could not be loaded. Please try again.",
  );
  assert.equal(response.headers.get("Cache-Control"), "no-store");
});
