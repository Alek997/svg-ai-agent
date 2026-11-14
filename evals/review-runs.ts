import { access, readdir } from "node:fs/promises";
import { resolve } from "node:path";

async function hasResults(directory: string) {
  try {
    await access(resolve(directory, "results.json"));
    return true;
  } catch {
    return false;
  }
}

export async function discoverReviewRuns(root: string) {
  const entries = await readdir(root, { withFileTypes: true });
  const runs: Array<{ id: string; directory: string }> = [];
  for (const entry of entries.filter((item) => item.isDirectory())) {
    const directory = resolve(root, entry.name);
    if (await hasResults(directory)) {
      runs.push({ id: entry.name, directory });
      continue;
    }
    const trials = await readdir(directory, { withFileTypes: true });
    for (const trial of trials.filter(
      (item) => item.isDirectory() && /^trial-[0-9]{2}$/.test(item.name),
    )) {
      const trialDirectory = resolve(directory, trial.name);
      if (await hasResults(trialDirectory))
        runs.push({
          id: `${entry.name}-${trial.name}`,
          directory: trialDirectory,
        });
    }
  }
  return runs.sort((a, b) => b.id.localeCompare(a.id));
}
