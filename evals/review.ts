import { createServer } from "node:http";
import { readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { escapeHtml, prepareReview } from "./review-artifacts";
import { createReviewHandler } from "./review-server";

async function main() {
  const { values } = parseArgs({
    options: {
      run: { type: "string" },
      serve: { type: "boolean", default: false },
      port: { type: "string", default: "4318" },
    },
  });
  const port = Number(values.port);
  if (!Number.isInteger(port) || port < 1024 || port > 65535)
    throw new Error("Choose a port between 1024 and 65535.");
  const root = resolve("evals/runs");
  const names = values.run
    ? [values.run]
    : (await readdir(root, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort()
        .reverse();
  if (!names.length) throw new Error("No saved runs. Run a live eval first.");
  const pages = new Map<string, string>();
  const directories = new Map<string, string>();
  for (const name of names) {
    if (!/^[a-zA-Z0-9_-]+$/.test(name))
      throw new Error("Invalid run directory name.");
    const review = await prepareReview(resolve(root, name));
    pages.set(`/${name}`, review.html);
    directories.set(name, resolve(root, name));
    console.log(
      `${name}: ${review.count} outputs. Reviews: ${review.reviewPath}`,
    );
  }
  pages.set(
    "/",
    `<!doctype html><html lang="en"><meta charset="utf-8"><title>SVG review runs</title><body style="font:18px/1.7 system-ui;max-width:900px;margin:40px auto;padding:20px"><h1>SVG review runs</h1><p>Choose a run, score its artwork and save reviews directly in the UI. Your existing reviews are preserved.</p><ul>${names.map((name) => `<li><a href="/${name}">${escapeHtml(name)}</a></li>`).join("")}</ul></body></html>`,
  );
  if (!values.serve) return;
  const server = createServer(
    createReviewHandler({
      directories,
      pages,
      origin: `http://127.0.0.1:${port}`,
    }),
  );
  server.on("error", (error) => {
    console.error(`Review server: ${error.message}`);
    process.exitCode = 1;
  });
  server.listen(port, "127.0.0.1", () =>
    console.log(`Review gallery: http://127.0.0.1:${port} (Ctrl+C to stop)`),
  );
}

main().catch((error) => {
  console.error(
    `Review preparation failed: ${error instanceof Error ? error.message : "Unknown error"}`,
  );
  process.exitCode = 1;
});
