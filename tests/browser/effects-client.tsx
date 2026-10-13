// Isolated regression checks: no Clerk, database, or provider calls.
import { act, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { SvgWorkspace } from "../../components/workspace/svg-workspace";
import { SvgCanvas } from "../../components/workspace/svg-canvas";
import { SvgImage } from "../../components/collections/svg-image";
import { sampleDocument } from "../../lib/workspace/sample";
import "./navigation";
import { renderCounts } from "./render-counts";
import { runStateOwnershipChecks } from "./state-ownership";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const fixture = document.getElementById("fixture")!;
const output = document.getElementById("results")!;
const root = createRoot(fixture);
const a = "00000000-0000-4000-8000-000000000001";
const b = "00000000-0000-4000-8000-000000000002";
const summary = (id: string) => ({
  id,
  title: id === a ? "Artwork A" : "Artwork B",
  updatedAt: "2026-10-13T00:00:00.000Z",
});
const page = (id: string) => ({
  conversation: {
    ...summary(id),
    revision: 1,
    activeRunId: null,
    leaseExpiresAt: null,
  },
  messages: [],
  document: { ...sampleDocument, name: id === a ? "a.svg" : "b.svg" },
  publicId: null,
  olderCursor: null,
});
let generationSignal: AbortSignal | null = null;
let failOpen = false;
let pendingOpen: (() => void) | null = null;
let delayOpen = false;
let generationCount = 0;
let failGeneration = false;
const originalFetch = window.fetch.bind(window);
window.fetch = async (input, options) => {
  const path = String(input);
  if (path === "/api/conversations" && options?.method === "POST")
    return Response.json({ ...summary(a), revision: 0 });
  if (path === "/api/conversations")
    return Response.json({
      conversations: [summary(a), summary(b)],
      nextCursor: null,
    });
  if (path.startsWith("/api/conversations/")) {
    if (failOpen)
      return Response.json(
        { error: "Synthetic open failure" },
        { status: 503 },
      );
    if (delayOpen)
      await new Promise<void>((resolve) => {
        pendingOpen = resolve;
      });
    return Response.json(page(path.split("/").at(-1)!));
  }
  if (path === "/api/generate") {
    generationCount++;
    if (failGeneration)
      return Response.json(
        { error: "Synthetic generation failure" },
        { status: 503 },
      );
    generationSignal = options?.signal ?? null;
    return new Promise<Response>((_, reject) => {
      generationSignal?.addEventListener(
        "abort",
        () => reject(new DOMException("Aborted", "AbortError")),
        { once: true },
      );
    });
  }
  throw new Error(`Unexpected fixture request: ${path}`);
};
const liveUrls = new Set<string>();
const createUrl = URL.createObjectURL.bind(URL);
const revokeUrl = URL.revokeObjectURL.bind(URL);
URL.createObjectURL = (blob) => {
  const url = createUrl(blob);
  liveUrls.add(url);
  return url;
};
URL.revokeObjectURL = (url) => {
  liveUrls.delete(url);
  revokeUrl(url);
};
function check(condition: unknown, name: string) {
  if (!condition) throw new Error(name);
  const item = document.createElement("li");
  item.textContent = `PASS: ${name}`;
  output.append(item);
}
async function render(node: React.ReactNode) {
  await act(async () => root.render(<StrictMode>{node}</StrictMode>));
}
async function click(label: string) {
  const button = Array.from(fixture.querySelectorAll("button")).find(
    (node) =>
      node.textContent?.trim().startsWith(label) ||
      node.getAttribute("aria-label") === label,
  );
  if (!button)
    throw new Error(
      `Missing button: ${label}; found ${Array.from(
        fixture.querySelectorAll("button"),
      )
        .map((node) => node.textContent)
        .join(" | ")}`,
    );
  await act(async () => button.click());
}
async function navigate(path: string) {
  await act(async () => window.history.pushState(null, "", path));
}
async function draft(text: string) {
  const node = fixture.querySelector("textarea")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )!.set!.call(node, text);
    node.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function run() {
  await render(<SvgCanvas document={sampleDocument} />);
  check(
    liveUrls.size === 2,
    "Strict Mode retains only image and download URLs",
  );
  const initial = fixture.querySelector("img")!.src;
  const download = fixture.querySelector<HTMLAnchorElement>("a[download]")!;
  check(
    (await (await originalFetch(download.href)).text()) ===
      sampleDocument.source && download.download === sampleDocument.name,
    "Download URL contains the complete SVG and filename",
  );
  await click("Code");
  check(liveUrls.size === 1, "Code view revokes its detached image URL");
  await click("Preview");
  check(
    fixture.querySelector("img")!.src !== initial && liveUrls.size === 2,
    "Returning to preview creates a live image URL",
  );
  await render(
    <SvgCanvas
      document={{
        ...sampleDocument,
        source:
          '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><circle cx="12" cy="12" r="8"/></svg>',
      }}
      isLoading
    />,
  );
  check(
    !fixture.querySelector("a[download]") && liveUrls.size === 1,
    "Generation removes download availability and revokes its URL",
  );
  await render(
    <SvgImage source={sampleDocument.source} label="Collection SVG" />,
  );
  check(
    liveUrls.size === 1,
    "Collection images reuse the same managed Blob lifecycle",
  );
  await render(<></>);
  check(liveUrls.size === 0, "Unmount revokes all SVG URLs");

  await navigate("/");
  await render(<SvgWorkspace />);
  const canvasRenders = renderCounts.get("SvgCanvas");
  const chatRenders = renderCounts.get("ChatPanel");
  await draft("Unsent home draft");
  await draft("Unsent home draft updated");
  check(
    renderCounts.get("SvgCanvas") === canvasRenders &&
      renderCounts.get("ChatPanel") === chatRenders,
    "Typing updates composer and navigation guard without rendering canvas or chat panel",
  );
  await draft("Unsent home draft");
  await click("Start a new icon");
  await click("Keep working");
  check(
    fixture.querySelector("textarea")?.value === "Unsent home draft",
    "Cancel navigation preserves the draft",
  );
  await click("Start a new icon");
  await click("Leave workspace");
  check(
    fixture.querySelector("textarea")?.value === "",
    "Starting over at home resets the whole session",
  );
  await click("A minimal mountain landscape");
  check(
    window.location.pathname === `/conversations/${a}` &&
      generationCount === 1 &&
      !generationSignal!.aborted,
    "Creating a conversation preserves its first generation under Strict Mode",
  );
  await click("Start a new icon");
  await click("Leave workspace");
  check(
    generationSignal!.aborted && window.location.pathname === "/",
    "Leaving generation aborts its request",
  );
  check(
    fixture.textContent?.includes("The canvas starts with sample artwork") &&
      !fixture.querySelector('[role="alert"]'),
    "Abandoned generation cannot overwrite the new workspace",
  );
  await navigate(`/conversations/${a}`);
  await draft("Draft for A");
  await click("Zoom in");
  await navigate(`/conversations/${b}`);
  check(
    fixture.querySelector("textarea")?.value === "" &&
      fixture.textContent?.includes("b.svg") &&
      !fixture.textContent?.includes("125%"),
    "Switching conversations resets draft and canvas state",
  );
  await act(async () => {
    const moved = new Promise<void>((resolve) =>
      window.addEventListener("popstate", () => resolve(), { once: true }),
    );
    window.history.back();
    await moved;
  });
  check(
    fixture.textContent?.includes("a.svg"),
    "Browser Back opens the previous conversation",
  );
  await act(async () => {
    const moved = new Promise<void>((resolve) =>
      window.addEventListener("popstate", () => resolve(), { once: true }),
    );
    window.history.forward();
    await moved;
  });
  check(
    fixture.textContent?.includes("b.svg"),
    "Browser Forward opens the next conversation",
  );
  failGeneration = true;
  await draft("A failing edit");
  await click("Send message");
  check(
    fixture.textContent?.includes("Synthetic generation failure") &&
      fixture.textContent?.includes("b.svg") &&
      fixture.querySelector("textarea")?.value === "A failing edit",
    "Failed generation preserves saved artwork and restores the submitted draft",
  );
  failGeneration = false;
  await draft("Keep on refresh");
  await click("Refresh saved conversation");
  check(
    fixture.querySelector("textarea")?.value === "Keep on refresh",
    "Refreshing the same conversation preserves its draft",
  );
  delayOpen = true;
  await navigate(`/conversations/${a}`);
  check(
    !!fixture.querySelector('[aria-label="Opening saved conversation"]') ||
      !fixture.querySelector("textarea"),
    "Opening a conversation displays loading state",
  );
  await navigate("/");
  delayOpen = false;
  await act(async () => pendingOpen?.());
  check(
    fixture.textContent?.includes("The canvas starts with sample artwork") &&
      !fixture.textContent?.includes("a.svg"),
    "A late saved response cannot replace the home session",
  );
  failOpen = true;
  await navigate(`/conversations/${a}`);
  check(
    fixture.textContent?.includes("Synthetic open failure"),
    "Failed saved opens display an error",
  );
  failOpen = false;
  await click("Refresh saved conversation");
  check(
    fixture.textContent?.includes("a.svg"),
    "Failed saved opens can be retried",
  );
  await navigate("/");
  await render(<></>);
  check(liveUrls.size === 0, "Workspace teardown releases all SVG resources");
  await runStateOwnershipChecks({ fixture, render, click, check });
  check(
    liveUrls.size === 0,
    "All state ownership checks release their SVG URLs",
  );
  document.title = "PASS: effect refactor regressions";
}
void run().catch((error) => {
  document.title = "FAIL: effect refactor regressions";
  const item = document.createElement("li");
  item.textContent = `FAIL: ${error.message}`;
  output.append(item);
  console.error(error);
});
