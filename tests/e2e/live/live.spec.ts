import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { safeSvgSchema } from "../../../lib/svg/validate-svg";
import {
  liveSmokeLimits,
  liveSmokePrompt,
  requireLiveSmokeApproval,
} from "./settings";

test("paid smoke: production drawing agent produces a validated, downloadable SVG", async ({
  page,
  request,
}, testInfo) => {
  requireLiveSmokeApproval();
  await page.goto("/");
  await page
    .getByRole("textbox", { name: "Describe your SVG" })
    .fill(liveSmokePrompt);
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  const canvas = page.getByRole("region", { name: "Canvas", exact: true });
  await expect(
    canvas
      .getByText("Generated", { exact: true })
      .or(page.getByRole("alert"))
      .first(),
  ).toBeVisible({ timeout: 95_000 });
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(canvas.getByRole("img")).toHaveAttribute("src", /^blob:/);
  const downloadPromise = page.waitForEvent("download");
  await canvas.getByRole("link", { name: "Download SVG" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.svg$/);
  expect(
    safeSvgSchema.safeParse(await readFile((await download.path())!, "utf8"))
      .success,
  ).toBe(true);
  await download.saveAs(testInfo.outputPath(download.suggestedFilename()));
  await page.screenshot({
    path: testInfo.outputPath("live-result.png"),
    fullPage: true,
  });
  const stats = await (await request.get("/__fixture/state")).json();
  expect(stats.generationCalls).toBe(1);
  expect(stats.providerRequests).toBeGreaterThan(0);
  expect(stats.providerRequests).toBeLessThanOrEqual(
    liveSmokeLimits.providerRequests,
  );
  expect(stats.largestInputBytes).toBeLessThanOrEqual(
    liveSmokeLimits.serializedInputBytesPerRequest,
  );
  console.log(
    "Live smoke usage:",
    JSON.stringify({
      providerRequests: stats.providerRequests,
      largestInputBytes: stats.largestInputBytes,
    }),
  );
});
