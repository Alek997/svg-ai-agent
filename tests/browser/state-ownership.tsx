// Browser-only regression scenarios with mocked requests, no database or providers.
import { act, type ReactNode } from "react";
import { CollectionManager } from "../../components/collections/collection-manager";
import { PublicSvg } from "../../components/public-svg";
import { ChatPanel } from "../../components/workspace/chat-panel";
import { GenerationFeedback } from "../../components/workspace/generation-feedback";
import { SvgCanvas } from "../../components/workspace/svg-canvas";
import { WorkspaceDraft } from "../../components/workspace/workspace-draft";
import { sampleDocument } from "../../lib/workspace/sample";
import type { CollectionIcon } from "../../lib/collections/contracts";
import { renderCounts } from "./render-counts";

type Harness = {
  fixture: HTMLElement;
  render: (node: ReactNode) => Promise<void>;
  click: (label: string) => Promise<void>;
  check: (condition: unknown, name: string) => void;
};
export async function runStateOwnershipChecks({
  fixture,
  render,
  click,
  check,
}: Harness) {
  async function wait(ms: number) {
    await act(async () => new Promise((resolve) => setTimeout(resolve, ms)));
  }
  async function until(predicate: () => boolean) {
    const deadline = Date.now() + 2000;
    while (!predicate()) {
      if (Date.now() > deadline)
        throw new Error("Timed out waiting for fixture request");
      await wait(10);
    }
  }
  async function input(selector: string, value: string) {
    const node = fixture.querySelector<HTMLInputElement | HTMLTextAreaElement>(
      selector,
    )!;
    await act(async () => {
      const prototype =
        node instanceof HTMLTextAreaElement
          ? HTMLTextAreaElement.prototype
          : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(
        node,
        value,
      );
      node.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }
  const fetchBefore = window.fetch;
  const confirmBefore = window.confirm;
  const clipboardBefore = Object.getOwnPropertyDescriptor(
    navigator,
    "clipboard",
  );
  let failCopy = false;
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: async () => {
        if (failCopy) throw new Error("Synthetic clipboard failure");
      },
    },
  });
  let publicStatus = 200;
  let feedbackStatus = 503;
  let feedbackCalls = 0;
  let createdName = "";
  let processCalls = 0;
  let processingSignal: AbortSignal | null = null;
  let pauseProcessing = true;
  const icon = (id: string, status: string): CollectionIcon => ({
    id,
    status,
    filename: `${id}.svg`,
    source: sampleDocument.source,
    hash: id,
    description: "A sample icon",
    tags: [],
    descriptionAttempts: 1,
    embeddingAttempts: 1,
    error: null,
    claimExpiresAt: null,
    embeddingModel: null,
    usage: [],
  });
  let icons = [icon("ready", "ready"), icon("pending", "pending")];
  window.confirm = () => true;
  window.fetch = async (request, options) => {
    const path = String(request);
    if (path.startsWith("/api/public/svgs/"))
      return new Response(
        publicStatus === 200 ? sampleDocument.source : "Unavailable",
        { status: publicStatus, headers: { "Content-Type": "image/svg+xml" } },
      );
    if (path === "/api/feedback") {
      feedbackCalls++;
      return Response.json(
        feedbackStatus === 200
          ? { ok: true }
          : { error: "Synthetic feedback failure" },
        { status: feedbackStatus },
      );
    }
    if (path === "/api/collections") {
      if (options?.method === "POST") {
        createdName = JSON.parse(String(options.body)).name;
        return Response.json({ id: "collection" });
      }
      return Response.json({
        collections: [
          {
            id: "collection",
            name: createdName || "Examples",
            total: icons.length,
            ready: icons.filter((item) => item.status === "ready").length,
          },
        ],
      });
    }
    if (path === "/api/collections/collection")
      return Response.json({
        collection: { id: "collection", name: createdName || "Examples" },
        icons,
      });
    if (path.endsWith("/search"))
      return Response.json({
        collectionName: "Examples",
        query: JSON.parse(String(options?.body)).query,
        candidates: [],
        references: [],
        conventions: [],
      });
    if (path.endsWith("/upload")) {
      icons = [...icons, icon("uploaded", "pending")];
      return Response.json({ results: [{ ok: true }] });
    }
    if (path.endsWith("/process")) {
      processCalls++;
      processingSignal = options?.signal ?? null;
      if (pauseProcessing)
        return new Promise<Response>((_, reject) =>
          processingSignal?.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true },
          ),
        );
      icons = icons.map((item) => ({ ...item, status: "ready" }));
      return Response.json({ processed: processCalls === 2 ? 2 : 0 });
    }
    if (path.endsWith("/delete-icon")) {
      icons = icons.filter(
        (item) => item.id !== JSON.parse(String(options?.body)).iconId,
      );
      return Response.json({ ok: true });
    }
    throw new Error(`Unexpected state ownership request: ${path}`);
  };
  try {
    await render(<SvgCanvas document={sampleDocument} />);
    await click("Zoom in");
    await click("Code");
    const canvasBeforeCopy = renderCounts.get("SvgCanvas");
    await click("Copy SVG code");
    check(
      fixture.textContent?.includes("Copied!") &&
        renderCounts.get("SvgCanvas") === canvasBeforeCopy,
      "Clipboard feedback stays within copy control",
    );
    await wait(2100);
    check(
      !fixture.textContent?.includes("Copied!"),
      "Clipboard success feedback expires",
    );
    failCopy = true;
    await click("Copy SVG code");
    check(
      fixture.textContent?.includes("Could not copy"),
      "Clipboard failures remain visible",
    );
    await click("Preview");
    check(
      fixture.textContent?.includes("125%"),
      "Preview zoom survives switching through Code view",
    );
    let retries = 0;
    const deadline = Date.now() + 450;
    await render(
      <WorkspaceDraft ref={() => {}}>
        <ChatPanel
          messages={[]}
          onSend={() => {}}
          onReset={() => {}}
          isLoading={false}
          progress={0}
          activity=""
          error="Synthetic retryable failure"
          retryAvailableAt={deadline}
          onRetry={() => {
            retries++;
          }}
        />
      </WorkspaceDraft>,
    );
    const chatBeforeTick = renderCounts.get("ChatPanel");
    await click("Retry in");
    check(retries === 0, "Retry is unavailable before its deadline");
    await wait(600);
    check(
      renderCounts.get("ChatPanel") === chatBeforeTick &&
        fixture.textContent?.includes("Retry generation"),
      "Countdown ticks update only the retry control",
    );
    await click("Retry generation");
    check(retries === 1, "Retry becomes available after its deadline");

    await render(
      <GenerationFeedback
        token="synthetic-token"
        expiresAt={Date.now() + 60_000}
      />,
    );
    await click("Poor generation");
    await input("textarea", "Keep this comment on failure");
    await click("Send feedback");
    check(
      feedbackCalls === 1 &&
        fixture.textContent?.includes("Synthetic feedback failure") &&
        fixture.querySelector("textarea")?.value ===
          "Keep this comment on failure",
      "Feedback failure retains form input for retry",
    );
    feedbackStatus = 200;
    await click("Send feedback");
    check(
      fixture.textContent?.includes("Thanks for your feedback"),
      "Feedback retry reaches saved state",
    );
    await render(
      <GenerationFeedback token="expiring-token" expiresAt={Date.now() + 40} />,
    );
    await wait(80);
    check(
      fixture.textContent?.includes("Feedback period has ended"),
      "Feedback expiry replaces the form",
    );
    await render(
      <GenerationFeedback
        token="fresh-token"
        expiresAt={Date.now() + 60_000}
      />,
    );
    check(
      !!fixture.querySelector("form"),
      "A new feedback deadline does not inherit previous expiry",
    );

    await render(<PublicSvg id="synthetic-public-artwork" />);
    await wait(50);
    check(
      !!fixture.querySelector("img"),
      "Public artwork loads a validated SVG image",
    );
    publicStatus = 503;
    await click("Download SVG");
    check(
      fixture.textContent?.includes("Download failed") &&
        !!fixture.querySelector("img"),
      "Public download failure retains the artwork for retry",
    );
    publicStatus = 404;
    await click("Download SVG");
    check(
      fixture.textContent?.includes("SVG unavailable") &&
        !fixture.querySelector("img"),
      "Public download rechecks availability and removes revoked artwork",
    );

    await render(<CollectionManager />);
    await until(() => !!fixture.textContent?.includes("Examples ·"));
    const managerBeforeName = renderCounts.get("CollectionManager");
    await input('[aria-label="Collection name"]', "My examples");
    check(
      renderCounts.get("CollectionManager") === managerBeforeName,
      "Collection name typing stays in creation form",
    );
    await click("Create collection");
    await until(
      () =>
        !!fixture.querySelector("#retrieval-query") &&
        fixture.querySelector<HTMLInputElement>(
          '[aria-label="Collection name"]',
        )?.value === "",
    );
    check(
      createdName === "My examples" &&
        fixture.querySelector<HTMLInputElement>(
          '[aria-label="Collection name"]',
        )?.value === "",
      "Collection creation opens its collection and clears its name",
    );
    const managerBeforeQuery = renderCounts.get("CollectionManager");
    await input("#retrieval-query", "round shapes");
    check(
      renderCounts.get("CollectionManager") === managerBeforeQuery,
      "Retrieval query typing stays in playground",
    );
    await click("Search");
    await until(() => !!fixture.textContent?.includes("Query: round shapes"));
    check(
      fixture.textContent?.includes("Query: round shapes"),
      "Retrieval renders search results",
    );
    const files = new DataTransfer();
    files.items.add(
      new File([sampleDocument.source], "uploaded.svg", {
        type: "image/svg+xml",
      }),
    );
    files.items.add(
      new File(["invalid"], "invalid.txt", { type: "text/plain" }),
    );
    await act(async () => {
      const upload =
        fixture.querySelector<HTMLInputElement>('input[type="file"]')!;
      upload.files = files.files;
      upload.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await until(
      () =>
        !!fixture.textContent?.includes("uploaded.svg: uploaded") &&
        !fixture.querySelector<HTMLButtonElement>("form button")?.disabled,
    );
    check(
      fixture.textContent?.includes("uploaded.svg: uploaded") &&
        fixture.textContent?.includes("invalid.txt: select an SVG under 64 KB"),
      "Upload reports preserve individual successes and rejected files",
    );
    await click("Start indexing");
    check(
      fixture.querySelector<HTMLButtonElement>("form button")?.disabled &&
        fixture.textContent?.includes("Pause"),
      "Indexing disables page-wide collection actions",
    );
    await click("Pause");
    await until(() => !fixture.textContent?.includes("Indexing batches"));
    check(
      processingSignal!.aborted &&
        !fixture.querySelector<HTMLButtonElement>("form button")?.disabled,
      "Pausing aborts indexing and releases page-wide disabling",
    );
    pauseProcessing = false;
    await click("Start indexing");
    await until(
      () =>
        !!fixture.textContent?.includes("3/3 searchable") &&
        !fixture.textContent?.includes("Indexing batches"),
    );
    check(
      processCalls === 3 && fixture.textContent?.includes("3/3 searchable"),
      "Indexing resumes bounded requests until no work remains",
    );
    await act(async () => {
      Array.from(fixture.querySelectorAll<HTMLButtonElement>("article button"))
        .find((button) => button.textContent?.trim() === "Delete")!
        .click();
    });
    await until(
      () =>
        !fixture.textContent?.includes("Query: round shapes") &&
        !fixture.querySelector<HTMLButtonElement>("form button")?.disabled,
    );
    check(
      !fixture.textContent?.includes("Query: round shapes") &&
        fixture.querySelector<HTMLInputElement>("#retrieval-query")?.value ===
          "round shapes",
      "Deleting an icon invalidates ranking while preserving search input",
    );
    await click("Search");
    await until(() => !!fixture.textContent?.includes("Query: round shapes"));
    await click("My examples ·");
    await until(
      () =>
        !fixture.textContent?.includes("Query: round shapes") &&
        !fixture.querySelector<HTMLButtonElement>("form button")?.disabled,
    );
    check(
      fixture.querySelector<HTMLInputElement>("#retrieval-query")?.value ===
        "round shapes",
      "Reopening a collection clears ranking and preserves its query",
    );
    icons = [...icons, icon("unmount-pending", "pending")];
    await click("Refresh status");
    await until(() => !!fixture.textContent?.includes("unmount-pending.svg"));
    pauseProcessing = true;
    await click("Start indexing");
    await render(<></>);
    check(
      processingSignal!.aborted,
      "Collection teardown aborts its indexing scheduler",
    );
  } finally {
    await render(<></>);
    window.fetch = fetchBefore;
    window.confirm = confirmBefore;
    if (clipboardBefore)
      Object.defineProperty(navigator, "clipboard", clipboardBefore);
    else Reflect.deleteProperty(navigator, "clipboard");
  }
}
