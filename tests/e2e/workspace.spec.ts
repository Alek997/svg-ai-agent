import { readFile } from "node:fs/promises";
import sharp from "sharp";
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

async function expectUsableConversation(page: Page, bottom: number) {
  const prompt = page.getByRole("textbox", { name: "Describe your SVG" });
  await expect(prompt).toBeVisible();
  await expect
    .poll(
      async () =>
        (await prompt.boundingBox())!.y + (await prompt.boundingBox())!.height,
    )
    .toBeLessThanOrEqual(bottom);
  const send = page.getByRole("button", { name: "Send message", exact: true });
  await expect(send).toBeInViewport();
  const sendBounds = (await send.boundingBox())!;
  expect(sendBounds.y + sendBounds.height).toBeLessThanOrEqual(bottom);
  const log = page.getByRole("log", { name: "Conversation history" });
  expect((await log.boundingBox())!.height).toBeGreaterThan(100);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBeTruthy();
}

for (const [width, height] of [
  [320, 568],
  [393, 852], // iPhone 15 Pro portrait
  [852, 393], // phone landscape
  [768, 1024],
  [1024, 768],
  [1440, 900],
  [2560, 1440],
]) {
  test(`conversation and canvas fit ${width} × ${height}`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.goto("/");
    await expectUsableConversation(page, height);
    const prompt = page.getByRole("textbox", { name: "Describe your SVG" });
    await prompt.fill("Keep this unsent draft");
    if (width < 1024) {
      const views = page.getByRole("navigation", { name: "Workspace view" });
      await views.getByRole("button", { name: "Canvas", exact: true }).click();
      await expect(canvas(page)).toBeVisible();
      expect(
        (await canvas(page).getByRole("img").boundingBox())!.height,
      ).toBeGreaterThan(40);
      const download = canvas(page).getByRole("link", { name: "Download SVG" });
      await expect(download).toBeInViewport();
      await canvas(page)
        .getByRole("button", { name: "Code", exact: true })
        .click();
      await expect(
        page.getByLabel("SVG source", { exact: true }),
      ).toBeInViewport();
      await views
        .getByRole("button", { name: "Conversation", exact: true })
        .click();
    } else {
      await expect(canvas(page)).toBeVisible();
    }
    await expect(prompt).toHaveValue("Keep this unsent draft");
    await expectUsableConversation(page, height);
  });
}

test("visual keyboard viewport keeps the composer and conversation reachable", async ({
  page,
}) => {
  await page.setViewportSize({ width: 393, height: 852 });
  await page.addInitScript(() => {
    const viewport = window.visualViewport!;
    let height = innerHeight;
    let offsetTop = 0;
    let scale = 1;
    Object.defineProperties(viewport, {
      height: { get: () => height },
      offsetTop: { get: () => offsetTop },
      scale: { get: () => scale },
    });
    window.addEventListener("fixture-viewport", (event) => {
      ({ height, offsetTop, scale } = (event as CustomEvent).detail);
      viewport.dispatchEvent(new Event("resize"));
      viewport.dispatchEvent(new Event("scroll"));
    });
  });
  await page.goto("/");
  const prompt = page.getByRole("textbox", { name: "Describe your SVG" });
  await prompt.fill("Draft while keyboard is open");
  await prompt.focus();
  for (const [height, offsetTop, scale] of [
    [420, 0, 1],
    [710, 0, 1.2], // Zoom must not retain the preceding keyboard height.
    [390, 30, 1],
    [852, 0, 1],
  ]) {
    await page.evaluate(
      ({ height, offsetTop, scale }) => {
        window.dispatchEvent(
          new CustomEvent("fixture-viewport", {
            detail: { height, offsetTop, scale },
          }),
        );
      },
      { height, offsetTop, scale },
    );
    await expect
      .poll(async () => (await page.getByRole("main").boundingBox())!.height)
      .toBe(scale === 1 ? height : 852);
    await expectUsableConversation(
      page,
      (scale === 1 ? height : 852) + offsetTop,
    );
    await expect(prompt).toHaveValue("Draft while keyboard is open");
    await expect(prompt).toBeFocused();
  }
});

test("phone can generate, inspect, download and recover from an unsafe result", async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 393, height: 852 });
  await page.goto("/");
  await scenario(request, "hold-generation");
  await sendMessage(page, "Draw an amber circle");
  await expect(
    page.getByRole("textbox", { name: "Describe your SVG" }),
  ).toBeDisabled();
  const views = page.getByRole("navigation", { name: "Workspace view" });
  await views.getByRole("button", { name: "Canvas", exact: true }).click();
  await expect(
    canvas(page).getByText("draft.svg", { exact: true }),
  ).toBeVisible();
  await request.post("/__fixture/release");
  await expect(
    canvas(page).getByText("circle-1.svg", { exact: true }),
  ).toBeVisible();
  await views
    .getByRole("button", { name: "Conversation", exact: true })
    .click();
  await expect(
    page
      .getByText("Created an amber circle.", { exact: true })
      .filter({ visible: true }),
  ).toBeInViewport();
  await expectUsableConversation(page, 852);
  await views.getByRole("button", { name: "Canvas", exact: true }).click();
  const downloadPromise = page.waitForEvent("download");
  await canvas(page).getByRole("link", { name: "Download SVG" }).click();
  expect((await downloadPromise).suggestedFilename()).toBe("circle-1.svg");
  await views
    .getByRole("button", { name: "Conversation", exact: true })
    .click();
  await scenario(request, "unsafe-result");
  await sendMessage(page, "Make it purple");
  await expect(page.getByRole("alert")).toBeVisible();
  await expectUsableConversation(page, 852);
  await views.getByRole("button", { name: "Canvas", exact: true }).click();
  await expect(
    canvas(page).getByText("circle-1.svg", { exact: true }),
  ).toBeVisible();
});

test("phone collection controls leave room for chat and remain accessible", async ({
  page,
}) => {
  await page.route("**/api/collections", (route) =>
    route.fulfill({ json: { collections: [] } }),
  );
  await page.setViewportSize({ width: 393, height: 852 });
  await page.goto("/?collections");
  const toggle = page.getByRole("button", { name: "Reference collections" });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await toggle.click();
  await expect(
    page.getByRole("combobox", { name: "Reference collection", exact: true }),
  ).toBeVisible();
  await expectUsableConversation(page, 852);
  await toggle.click();
  await page.setViewportSize({ width: 393, height: 420 });
  await expectUsableConversation(page, 420);
});

test("workspace paints to the right and bottom edges after focused viewport changes", async ({
  page,
}) => {
  await page.goto("/");
  const prompt = page.getByRole("textbox", { name: "Describe your SVG" });
  await prompt.fill("Unsent viewport resize check");
  for (const [width, height] of [
    [393, 852],
    [393, 420],
    [852, 393],
    [393, 852],
  ]) {
    await page.setViewportSize({ width, height });
    await expect
      .poll(async () => {
        const bounds = (await page.getByRole("main").boundingBox())!;
        return {
          right: bounds.x + bounds.width,
          bottom: bounds.y + bounds.height,
        };
      })
      .toEqual({ right: width, bottom: height });
    // Check painted pixels too: DOM bounds alone miss visible blank margins.
    const heading = (await page
      .getByRole("heading", { name: "Conversation", exact: true })
      .boundingBox())!;
    const screenshot = await page.screenshot({ scale: "css" });
    const { data, info } = await sharp(screenshot)
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    for (const [x, y] of [
      [width - 2, Math.floor(heading.y + heading.height / 2)],
      [Math.floor(width / 2), height - 2],
    ]) {
      const index = (y * info.width + x) * info.channels;
      expect([...data.subarray(index, index + 3)]).toEqual([255, 255, 255]);
    }
    await expect(prompt).toHaveValue("Unsent viewport resize check");
  }
});

for (const width of [320, 393, 768]) {
  test(`hamburger navigation fits ${width}px and supports dismissal`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 852 });
    await page.goto("/");
    const toggle = page.getByRole("button", { name: "Open navigation menu" });
    const menu = page.getByRole("navigation", { name: "Mobile navigation" });
    await expect(toggle).toBeVisible();
    await expect(
      page.getByRole("navigation", { name: "Main navigation" }),
    ).toBeHidden();
    expect(
      await page
        .locator("header")
        .evaluate((el) => el.scrollWidth <= el.clientWidth),
    ).toBeTruthy();
    await toggle.press("Enter");
    await expect(menu).toBeVisible();
    await expect(
      menu.getByRole("link", { name: "My SVGs", exact: true }),
    ).toHaveAttribute("href", "/conversations");
    await expect(
      menu.getByRole("link", { name: "Collections", exact: true }),
    ).toBeVisible();
    await expect(
      menu.getByRole("link", { name: "Eval Runs", exact: true }),
    ).toBeVisible();
    await expect(
      menu.getByRole("button", { name: "Open user menu" }),
    ).toBeVisible();
    const bounds = (await menu.boundingBox())!;
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await expect(toggle).toBeFocused();
    await toggle.click();
    await menu.getByRole("button", { name: "Close navigation menu" }).click();
    await expect(menu).toBeHidden();
    await toggle.click();
    await page.getByRole("heading", { name: /^SVG Studio/ }).click();
    await expect(menu).toBeHidden();
  });
}

test("mobile navigation preserves the browser's unsent-draft warning", async ({
  page,
}) => {
  await page.setViewportSize({ width: 393, height: 852 });
  await page.goto("/");
  const prompt = page.getByRole("textbox", { name: "Describe your SVG" });
  await prompt.fill("Keep my unsent artwork request");
  await page.getByRole("button", { name: "Open navigation menu" }).click();
  const warning = page.waitForEvent("dialog");
  const navigation = page
    .getByRole("navigation", { name: "Mobile navigation" })
    .getByRole("link", { name: "My SVGs", exact: true })
    .click();
  const dialog = await warning;
  expect(dialog.type()).toBe("beforeunload");
  await dialog.dismiss();
  await navigation;
  await expect(page).toHaveURL("/");
  await expect(prompt).toHaveValue("Keep my unsent artwork request");
});

test("header keeps feature-gated links hidden and desktop navigation inline", async ({
  page,
}) => {
  await page.setViewportSize({ width: 393, height: 852 });
  await page.goto("/?basic-navigation");
  await page.getByRole("button", { name: "Open navigation menu" }).click();
  await expect(
    page.getByRole("link", { name: "Collections", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Eval Runs", exact: true }),
  ).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Open navigation menu" }),
  ).toBeHidden();
  const desktop = page.getByRole("navigation", { name: "Main navigation" });
  await expect(desktop).toBeVisible();
  await expect(
    desktop.getByRole("link", { name: "My SVGs", exact: true }),
  ).toBeVisible();
  await expect(
    desktop.getByRole("link", { name: "Collections", exact: true }),
  ).toBeVisible();
  await expect(
    desktop.getByRole("link", { name: "Eval Runs", exact: true }),
  ).toBeVisible();
  await expect(
    desktop.getByRole("button", { name: "Open user menu" }),
  ).toBeVisible();
});
