import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { discoverReviewRuns } from "../evals/review-runs";

test("review run discovery preserves legacy folders and exposes each trial as a safe flat ID", async () => {
  const root = await mkdtemp(join(tmpdir(), "svg-review-runs-"));
  try {
    const legacy = join(root, "2026-10-01T00-00-00");
    const trialOne = join(root, "2026-11-01T00-00-00", "trial-01");
    const trialTwo = join(root, "2026-11-01T00-00-00", "trial-02");
    await mkdir(legacy, { recursive: true });
    await mkdir(trialOne, { recursive: true });
    await mkdir(trialTwo, { recursive: true });
    await writeFile(join(legacy, "results.json"), "{}");
    await writeFile(join(trialOne, "results.json"), "{}");
    await writeFile(join(trialTwo, "results.json"), "{}");
    const runs = await discoverReviewRuns(root);
    assert.deepEqual(
      runs.map((run) => run.id),
      [
        "2026-11-01T00-00-00-trial-02",
        "2026-11-01T00-00-00-trial-01",
        "2026-10-01T00-00-00",
      ],
    );
    assert.equal(runs[1].directory, trialOne);
    assert.ok(runs.every((run) => !run.id.includes("/")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
