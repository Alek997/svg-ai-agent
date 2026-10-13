import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { hasRagCapability } from "../lib/collections/capability";
import { iconUploadSchema } from "../lib/collections/contracts";
import { validateEmbedding, embeddingText } from "../lib/collections/process";
import {
  fuseRanks,
  selectReferences,
  observeConventions,
  buildCollectionRetrievalQuery,
  withoutReferenceSources,
} from "../lib/collections/retrieval";
import { buildSvgAgentMessages } from "../lib/ai/svg-agent";
import { renderSvg } from "../lib/svg/render-svg";
import sharp from "sharp";
const source =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="black" stroke-width="2"><circle cx="12" cy="12" r="8"/></svg>';
test("RAG capability is default-off and requires the exact array entry", () => {
  for (const metadata of [
    null,
    {},
    { capabilities: "feature-rag" },
    { capabilities: ["admin"] },
    { capabilities: ["FEATURE-RAG"] },
  ])
    assert.equal(hasRagCapability(metadata), false);
  assert.equal(hasRagCapability({ capabilities: ["feature-rag"] }), true);
});
test("upload bounds and XML allowlist reject unsafe or oversized files individually", () => {
  assert.equal(
    iconUploadSchema.parse({ filename: "circle.svg", source }).source,
    source,
  );
  for (const file of [
    { filename: "circle.zip", source },
    {
      filename: "circle.svg",
      source: source.replace("<circle", "<script/><circle"),
    },
    {
      filename: "circle.svg",
      source: source.replace('r="8"', 'r="8" onclick="alert(1)"'),
    },
    { filename: "circle.svg", source: "x".repeat(48001) },
    {
      filename: "circle.svg",
      source:
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><desc>' +
        "界".repeat(23000) +
        "</desc></svg>",
    },
  ])
    assert.equal(iconUploadSchema.safeParse(file).success, false);
});
test("embedding input contains filename, description, and tags and vectors are compatible", () => {
  assert.match(
    embeddingText({
      filename: "circle.svg",
      description: "Outline circle",
      tags: ["round"],
    }),
    /circle.svg\nOutline circle\nround/,
  );
  assert.equal(validateEmbedding([1, ...Array(1535).fill(0)]).length, 1536);
  for (const vector of [
    [1],
    Array(1536).fill(0),
    Array(1536).fill(NaN),
    Array(1536).fill(Infinity),
  ])
    assert.throws(() => validateEmbedding(vector));
});
test("equal-weight RRF combines ranks with k=60 and stable ID ties", () => {
  const rows = fuseRanks(
    [
      { id: "b", score: 0.9 },
      { id: "a", score: 0.8 },
    ],
    ["a", "c"],
  );
  assert.equal(rows[0].id, "a");
  assert.equal(rows[0].fusedScore, 1 / 62 + 1 / 61);
  assert.equal(rows[0].semanticRank, 2);
  assert.equal(rows[0].keywordRank, 1);
  assert.equal(fuseRanks([{ id: "b", score: 0.9 }], ["a"])[0].id, "a");
});
test("reference budgets skip whole markup rather than truncating and cap at three", () => {
  const large = source.replace(
    "<circle",
    `<desc>${"x".repeat(46000)}</desc><circle`,
  );
  const medium = source.replace(
    "<circle",
    `<desc>${"x".repeat(3000)}</desc><circle`,
  );
  const rows = [large, medium, source, source, source].map((svg, i) => ({
    id: randomUUID(),
    hash: `${i}`,
    source: svg,
  }));
  const selected = selectReferences(rows);
  assert.equal(selected.length, 3);
  assert.equal(selected[0].source, large);
  assert.equal(selected[1].source, source);
  assert.ok(selected.reduce((sum, row) => sum + row.source.length, 0) <= 48000);
});
test("conventions are parser observations and query construction uses initial plus latest", () => {
  assert.ok(
    observeConventions([source, source]).some((value) =>
      value.includes("stroke-width=2"),
    ),
  );
  assert.equal(
    buildCollectionRetrievalQuery({
      initialArtworkRequest: "Draw a circle",
      latestUserMessage: "Make it blue",
    }),
    "Draw a circle\nMake it blue",
  );
  assert.equal(
    buildCollectionRetrievalQuery({
      initialArtworkRequest: "Circle",
      latestUserMessage: "Circle",
    }),
    "Circle",
  );
});
test("stored evidence omits source copies and model references remain untrusted visual data", () => {
  const detail = {
    query: "Circle",
    collectionId: randomUUID(),
    collectionName: "Synthetic",
    candidates: [],
    references: [
      {
        id: randomUUID(),
        iconId: randomUUID(),
        hash: "hash",
        source,
        deleted: false,
      },
    ],
    conventions: [],
  };
  assert.equal(withoutReferenceSources(detail).references[0].source, null);
  const messages = buildSvgAgentMessages({
    svgGenerationRequest: { messages: [{ role: "user", content: "Circle" }] },
    collectionRetrievalContext: detail,
  });
  assert.match(messages[0].content, /Untrusted collection reference data/);
  assert.ok(messages[0].content.includes(JSON.stringify(source)));
});
test("shared renderer validates first and bounds temporary PNGs to 256 square", async () => {
  const png = await renderSvg(source);
  const metadata = await sharp(png).metadata();
  assert.equal(metadata.width, 256);
  assert.equal(metadata.height, 256);
  assert.equal(metadata.format, "png");
  assert.equal(metadata.hasAlpha, true);
  const { data, info } = await sharp(png)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  assert.equal(data[3], 0, "The empty canvas corner must remain transparent.");
  assert.equal(
    data[(128 * info.width + 128) * info.channels + 3],
    0,
    "The empty circle interior must remain transparent.",
  );
  assert.ok(
    data.some((value, index) => index % info.channels === 3 && value > 0),
    "The icon artwork must remain visible.",
  );
  await assert.rejects(() => renderSvg("<svg><script/></svg>"));
  await assert.rejects(() => renderSvg(source, 4096));
});
test("renderer preserves an actual SVG background while keeping resize padding transparent", async () => {
  const png = await renderSvg(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 12"><rect width="24" height="12" fill="#e5e7eb"/></svg>',
  );
  const { data, info } = await sharp(png)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  assert.equal(data[3], 0);
  const middle = (128 * info.width + 128) * info.channels;
  assert.deepEqual(
    [...data.subarray(middle, middle + 4)],
    [229, 231, 235, 255],
  );
});
