import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { prepareReview } from "../evals/review-artifacts";

const svg =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="30" fill="blue"/></svg>';
const item = {
  id: "review-circle",
  tags: ["edit"],
  input: {
    messages: [
      {
        role: "user",
        content: "<script>alert('prompt')</script> Make it blue.",
      },
    ],
    currentSvg: svg,
  },
  expected: { requirements: ["Blue circle"] },
};

test("reviews bind exact output, render safe before/after images, exclude failures and preserve human annotations", async () => {
  const directory = await mkdtemp(join(tmpdir(), "svg-review-"));
  try {
    await writeFile(
      join(directory, "results.json"),
      JSON.stringify({
        results: [
          {
            input: item,
            output: { status: "completed", source: svg },
            scores: { prompt_fidelity: 1 },
          },
          {
            input: { ...item, id: "failed-circle" },
            output: { status: "failed", source: null },
          },
        ],
      }),
    );
    const review = await prepareReview(directory);
    assert.equal(review.count, 1);
    assert.equal(review.failed, 1);
    assert.equal(
      (review.html.match(/data:image\/png;base64,/g) ?? []).length,
      2,
    );
    assert.ok(!review.html.includes("<script>"));
    assert.ok(review.html.includes("&lt;script&gt;"));
    assert.ok(!review.html.includes("<svg"));
    assert.ok(!review.html.includes("prompt_fidelity"));
    const yamlPath = join(directory, "human-reviews.yaml");
    const yaml = await readFile(yamlPath, "utf8");
    assert.ok(yaml.includes(createHash("sha256").update(svg).digest("hex")));
    assert.ok(!yaml.includes("failed-circle"));
    await writeFile(yamlPath, yaml.replace("quality: null", "quality: 2"));
    await prepareReview(directory);
    assert.ok((await readFile(yamlPath, "utf8")).includes("quality: 2"));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("review preparation rejects unsafe completed SVG before creating review artifacts", async () => {
  const directory = await mkdtemp(join(tmpdir(), "svg-review-"));
  try {
    await writeFile(
      join(directory, "results.json"),
      JSON.stringify({
        results: [
          {
            input: item,
            output: {
              status: "completed",
              source:
                '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
            },
          },
        ],
      }),
    );
    await assert.rejects(prepareReview(directory));
    await assert.rejects(readFile(join(directory, "human-reviews.yaml")));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
