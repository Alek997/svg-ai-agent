import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { init } from "braintrust";
import {
  humanReviewsSchema,
  matchHumanScoreRows,
  parseHumanReviews,
  outputHash,
  prepareHumanScores,
  reviewRunSchema,
} from "./human-reviews";
import { reviewRubricVersion } from "./review-artifacts";

export class SyncError extends Error {}

// Braintrust reads can briefly lag a completed feedback upload. Retry reads only;
// never repeat writes or claim success before every expected value is visible.
export async function verifyHumanScores(
  updates: Array<{ id: string; scores: Record<string, number | null> }>,
  read: () => Promise<
    Array<{ id: string; scores?: Record<string, number | null> }>
  >,
  pause: (ms: number) => Promise<void> = (ms) =>
    new Promise((done) => setTimeout(done, ms)),
) {
  for (const delay of [0, 500, 1000, 2000, 3000, 5000]) {
    if (delay) await pause(delay);
    const rows = await read();
    if (
      updates.every((update) => {
        const row = rows.find((item) => item.id === update.id);
        return (
          row &&
          Object.entries(update.scores).every(
            ([name, value]) => (row.scores?.[name] ?? null) === value,
          )
        );
      })
    )
      return;
  }
  throw new SyncError(
    "Braintrust did not return the expected human scores. Retry sync to verify; some writes may already have succeeded.",
  );
}

export async function loadHumanReviewPlan(directory: string) {
  const run = reviewRunSchema.parse(
    JSON.parse(await readFile(resolve(directory, "results.json"), "utf8")),
  );
  const path = resolve(directory, "human-reviews.yaml");
  const text = existsSync(path) ? await readFile(path, "utf8") : null;
  const reviews =
    text !== null
      ? parseHumanReviews(text)
      : humanReviewsSchema.parse({
          rubric_version: reviewRubricVersion,
          reviewer: "",
          reviews: [],
        });
  return {
    run,
    plan: prepareHumanScores(run, reviews),
    revision: text === null ? null : outputHash(text),
  };
}

export async function syncHumanReviews(
  directory: string,
  expectedRevision?: string,
) {
  try {
    const { run, plan, revision } = await loadHumanReviewPlan(directory);
    if (expectedRevision !== undefined && revision !== expectedRevision)
      throw new SyncError(
        "Saved reviews changed. Reload the page before syncing.",
      );
    if (
      run.metadata?.braintrustUpload === false ||
      (!run.metadata?.braintrustUpload && !run.summary.experimentUrl)
    )
      throw new SyncError(
        "This run has no recorded Braintrust upload. Local-only runs cannot be synced.",
      );
    if (existsSync(".env.local")) process.loadEnvFile(".env.local");
    if (!process.env.BRAINTRUST_API_KEY?.trim())
      throw new SyncError("Set BRAINTRUST_API_KEY in .env.local.");
    const options = {
      projectId: run.summary.projectId,
      experiment: run.summary.experimentName,
      apiKey: process.env.BRAINTRUST_API_KEY,
      setCurrent: false,
    };
    // Open read-only first; never create an experiment to compensate for a missing one.
    const existing = init({ ...options, open: true });
    if ((await existing.id) !== run.summary.experimentId)
      throw new SyncError("Braintrust experiment ID does not match saved run.");
    const remote = await existing.fetchedData();
    // Validate all rows before queuing any writes, including legacy runs without row IDs.
    const updates = matchHumanScoreRows(plan, remote);
    const experiment = init({ ...options, update: true });
    if ((await experiment.id) !== run.summary.experimentId)
      throw new SyncError("Braintrust experiment changed before sync.");
    for (const { id, scores, metadata } of updates)
      experiment.logFeedback({ id, scores, metadata, source: "external" });
    await experiment.flush();
    await verifyHumanScores(updates, async () => {
      existing.clearCache();
      return existing.fetchedData();
    });
    await writeFile(
      resolve(directory, "human-review-sync.json"),
      JSON.stringify(
        {
          syncedAt: new Date().toISOString(),
          reviewRevision: revision,
          experimentId: run.summary.experimentId,
          updates,
        },
        null,
        2,
      ),
    );
    return {
      count: updates.length,
      qualityRated: plan.filter(
        (item) => item.scores.human_visual_quality !== null,
      ).length,
      acceptableRated: plan.filter(
        (item) => item.scores.human_acceptable !== null,
      ).length,
      revision,
    };
  } catch (error) {
    if (error instanceof SyncError) throw error;
    throw new SyncError(
      "Human review sync failed. Check saved ratings, SVG hashes, experiment identity and Braintrust connectivity. Some updates may already have succeeded; you can retry safely.",
    );
  }
}
