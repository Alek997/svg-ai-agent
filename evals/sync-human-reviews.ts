import { resolve } from "node:path";
import { parseArgs } from "node:util";
import {
  loadHumanReviewPlan,
  syncHumanReviews,
  SyncError,
} from "./braintrust-reviews";

async function main() {
  const { values } = parseArgs({
    options: {
      run: { type: "string" },
      upload: { type: "boolean", default: false },
    },
  });
  if (!values.run || !/^[a-zA-Z0-9_-]+$/.test(values.run))
    throw new SyncError(
      "Use --run <saved-run-directory-name>, optionally --upload to sync.",
    );
  const directory = resolve("evals/runs", values.run);
  const { run, plan } = await loadHumanReviewPlan(directory);
  console.log(
    `Target: ${run.summary.experimentName} (${run.summary.experimentId})`,
  );
  console.log(
    `Visual quality: ${plan.filter((item) => item.scores.human_visual_quality !== null).length}/${plan.length} rated. Acceptable: ${plan.filter((item) => item.scores.human_acceptable !== null).length}/${plan.length} rated. Others: null (unscored).`,
  );
  if (!values.upload) {
    console.log(
      "Validated locally. Nothing uploaded. Add --upload to sync scores and review notes to existing Braintrust rows.",
    );
    return;
  }
  const result = await syncHumanReviews(directory);
  console.log(
    `Synced ${result.count} existing rows. Missing scores remain null. Local receipt: ${resolve(directory, "human-review-sync.json")}`,
  );
}
main().catch((error) => {
  console.error(
    error instanceof SyncError
      ? error.message
      : "Human review sync failed. Check YAML fields, exact SVG hashes, experiment identity and Braintrust connectivity. No raw SDK error was logged.",
  );
  process.exitCode = 1;
});
