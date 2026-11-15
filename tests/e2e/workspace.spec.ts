import { readFile } from "node:fs/promises";
import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";

async function scenario(request: APIRequestContext, mode: string) {
  const response = await request.post("/__fixture/scenario", {
    data: { mode },
  });
  expect(response.ok()).toBeTruthy();
}
async function sendMessage(page: Page, content: string) {
  await page.getByRole("textbox", { name: "Describe your SVG" }).fill(content);
  await page.getByRole("button", { name: "Send message", exact: true }).click();
}
async function createArtwork(page: Page) {
  await page.goto("/");
  await sendMessage(page, "Draw an amber circle");
  await expect(
    page
      .getByRole("region", { name: "Canvas", exact: true })
      .getByText("circle-1.svg", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Describe your SVG" }),
  ).toBeEnabled();
}
const canvas = (page: Page) =>
  page.getByRole("region", { name: "Canvas", exact: true });

test.beforeEach(async ({ request }) => {
  expect((await request.post("/__fixture/reset")).ok()).toBeTruthy();
});

test("creates once, shows safe previews, downloads the saved result, edits and reopens", async ({
  page,
  request,
}) => {
  await page.goto("/");
  await scenario(request, "hold-generation");
  await sendMessage(page, "Draw an amber circle");
  await expect(page).toHaveURL(/\/conversations\/[a-f0-9-]+$/);
  await expect(
    canvas(page).getByText("draft.svg", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Describe your SVG" }),
  ).toBeDisabled();
  await expect(
    canvas(page).getByRole("button", { name: "Download SVG" }),
  ).toBeDisabled();
  await expect(
    canvas(page).getByRole("link", { name: "Download SVG" }),
  ).toHaveCount(0);
  await expect(canvas(page).getByRole("img")).toHaveAttribute("src", /^blob:/);
  const running = await (await request.get("/__fixture/state")).json();
  expect(running.generationCalls).toBe(1);
  expect(running.submissions[0]).toEqual({
    kind: "message",
    content: "Draw an amber circle",
    conversationId: expect.any(String),
    requestId: expect.any(String),
    expectedRevision: 0,
  });
  await request.post("/__fixture/release");
  await expect(
    canvas(page).getByText("circle-1.svg", { exact: true }),
  ).toBeVisible();
  await expect(
    page
      .getByText("Created an amber circle.", { exact: true })
      .filter({ visible: true }),
  ).toBeVisible();
  const conversationUrl = page.url();
  const saved = await (
    await request.get(
      new URL(conversationUrl).pathname.replace(
        "/conversations/",
        "/api/conversations/",
      ),
    )
  ).json();
  const downloadPromise = page.waitForEvent("download");
  await canvas(page).getByRole("link", { name: "Download SVG" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("circle-1.svg");
  expect(await readFile((await download.path())!, "utf8")).toBe(
    saved.document.source,
  );
  await sendMessage(page, "Make the circle purple");
  await expect(
    canvas(page).getByText("circle-2.svg", { exact: true }),
  ).toBeVisible();
  await expect(page).toHaveURL(conversationUrl);
  await expect(
    page
      .getByText("Updated the circle to purple.", { exact: true })
      .filter({ visible: true }),
  ).toBeVisible();
  const finished = await (await request.get("/__fixture/state")).json();
  expect(finished.submissions[1].expectedRevision).toBe(1);
  expect(finished.submissions[1]).not.toHaveProperty("messages");
  expect(finished.submissions[1]).not.toHaveProperty("currentSvg");
  await page.reload();
  await expect(
    canvas(page).getByText("circle-2.svg", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Describe your SVG" }),
  ).toBeEnabled();
});

test("rejected submission restores its draft and preserves completed artwork", async ({
  page,
  request,
}) => {
  await createArtwork(page);
  await scenario(request, "reject-request");
  await sendMessage(page, "An edit that could not be accepted");
  await expect(page.getByRole("alert")).toContainText(
    "Synthetic request could not be accepted.",
  );
  await expect(
    page.getByRole("textbox", { name: "Describe your SVG" }),
  ).toHaveValue("An edit that could not be accepted");
  await expect(
    canvas(page).getByText("circle-1.svg", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /^Retry/ })).toHaveCount(0);
  await expect(
    page
      .getByRole("log", { name: "Conversation history", exact: true })
      .getByText("An edit that could not be accepted", { exact: true }),
  ).toHaveCount(0);
});

test("accepted failure preserves artwork and retries the saved attempt after its cooldown", async ({
  page,
  request,
}) => {
  await page.clock.install();
  await createArtwork(page);
  await scenario(request, "fail-generation");
  await sendMessage(page, "Make the circle purple");
  const retry = page.getByRole("button", { name: /^Retry in/ });
  await expect(retry).toBeDisabled();
  await expect(
    canvas(page).getByText("circle-1.svg", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Describe your SVG" }),
  ).toHaveValue("");
  await page.clock.fastForward(16_000);
  await page
    .getByRole("button", { name: "Retry generation", exact: true })
    .click();
  await expect(
    canvas(page).getByText("circle-3.svg", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  const state = await (await request.get("/__fixture/state")).json();
  expect(state.submissions[2]).toMatchObject({
    kind: "retry",
    retryOf: expect.any(String),
    requestId: expect.any(String),
    expectedRevision: 2,
  });
  await expect(
    page
      .getByRole("log", { name: "Conversation history", exact: true })
      .getByText("Make the circle purple", { exact: true }),
  ).toHaveCount(1);
});

test("leaving a generation cancels it and late completion cannot replace the new workspace", async ({
  page,
  request,
}) => {
  await page.goto("/");
  await scenario(request, "hold-generation");
  await sendMessage(page, "Draw an amber circle");
  await expect(
    canvas(page).getByText("draft.svg", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Start a new icon", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Leave workspace", exact: true })
    .click();
  await expect(page).toHaveURL("/");
  await expect(
    canvas(page).getByText("little-landscape.svg", { exact: true }),
  ).toBeVisible();
  await expect
    .poll(
      async () =>
        (await (await request.get("/__fixture/state")).json())
          .cancelledGenerations,
    )
    .toBe(1);
  await request.post("/__fixture/release");
  await expect(
    page.getByRole("textbox", { name: "Describe your SVG" }),
  ).toBeEnabled();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(
    canvas(page).getByText("little-landscape.svg", { exact: true }),
  ).toBeVisible();
});

test("unsafe final SVG never replaces or downloads over the previous completed artwork", async ({
  page,
  request,
}) => {
  await createArtwork(page);
  await scenario(request, "unsafe-result");
  await sendMessage(page, "Make the circle purple");
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(
    canvas(page).getByText("circle-1.svg", { exact: true }),
  ).toBeVisible();
  await expect(
    canvas(page).getByText("circle-2.svg", { exact: true }),
  ).toHaveCount(0);
  const downloadPromise = page.waitForEvent("download");
  await canvas(page).getByRole("link", { name: "Download SVG" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("circle-1.svg");
  expect(await readFile((await download.path())!, "utf8")).not.toContain(
    "<script",
  );
});

test("saved-state reconciliation recovers success when delivery loses the terminal result", async ({
  page,
  request,
}) => {
  await page.goto("/");
  await scenario(request, "lost-result");
  await sendMessage(page, "Draw an amber circle");
  await expect(
    canvas(page).getByText("circle-1.svg", { exact: true }),
  ).toBeVisible();
  await expect(
    page
      .getByText("Created an amber circle.", { exact: true })
      .filter({ visible: true }),
  ).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(
    page.getByRole("textbox", { name: "Describe your SVG" }),
  ).toBeEnabled();
});

test("conversation conflicts refresh saved state and preserve the rejected draft", async ({
  page,
  request,
}) => {
  await createArtwork(page);
  await scenario(request, "conflict");
  await sendMessage(page, "A stale edit");
  await expect(
    page.getByRole("textbox", { name: "Describe your SVG" }),
  ).toHaveValue("A stale edit");
  await expect(
    page.getByRole("textbox", { name: "Describe your SVG" }),
  ).toBeEnabled();
  await expect(
    canvas(page).getByText("circle-1.svg", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /^Retry/ })).toHaveCount(0);
});

test("unconfirmed saved state blocks new submissions until the conversation is reopened", async ({
  page,
  request,
}) => {
  await createArtwork(page);
  await scenario(request, "fail-confirmation");
  await sendMessage(page, "Make the circle purple");
  await expect(page.getByRole("alert")).toContainText(
    "Unable to confirm saved state",
  );
  await expect(
    page.getByRole("textbox", { name: "Describe your SVG" }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Send message", exact: true }),
  ).toBeDisabled();
  await expect(page.getByRole("button", { name: /^Retry/ })).toHaveCount(0);
});
