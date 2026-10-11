"use client";
import { useEffect, useRef, useState } from "react";
import type {
  CollectionSummary,
  CollectionIcon,
  Retrieval,
} from "@/lib/collections/contracts";
import { collectionRequest } from "./client";
import { SvgImage } from "./svg-image";
import { RetrievalDetails } from "./retrieval-details";
type Page = {
  collection: { id: string; name: string };
  icons: CollectionIcon[];
};
const button =
  "rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm disabled:opacity-40";
export function CollectionManager() {
  const [collections, setCollections] = useState<CollectionSummary[]>([]);
  const [page, setPage] = useState<Page | null>(null);
  const [name, setName] = useState("");
  const [query, setQuery] = useState("");
  const [ranking, setRanking] = useState<Retrieval | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [uploadReport, setUploadReport] = useState<string[]>([]);
  const scheduler = useRef<AbortController | null>(null);
  async function refresh(id?: string, signal?: AbortSignal) {
    const listed = await collectionRequest<{
      collections: CollectionSummary[];
    }>("", undefined, signal);
    setCollections(listed.collections);
    if (id) setPage(await collectionRequest<Page>(`/${id}`, undefined, signal));
  }
  useEffect(() => {
    const controller = new AbortController();
    void collectionRequest<{ collections: CollectionSummary[] }>(
      "",
      undefined,
      controller.signal,
    )
      .then((value) => setCollections(value.collections))
      .catch((error) => {
        if (!controller.signal.aborted) setError(error.message);
      });
    return () => {
      controller.abort();
      scheduler.current?.abort();
    };
  }, []);
  async function act(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Request failed.");
    } finally {
      setBusy(false);
    }
  }
  async function open(id: string) {
    scheduler.current?.abort();
    setRanking(null);
    await refresh(id);
  }
  async function upload(files: FileList | null) {
    if (!page || !files) return;
    const id = page.collection.id;
    const report: string[] = [];
    setUploadReport([]);
    await act(async () => {
      // One file per bounded request keeps partial failures and progress visible.
      for (const file of Array.from(files)) {
        if (!file.name.toLowerCase().endsWith(".svg") || file.size > 65536) {
          report.push(`${file.name}: select an SVG under 64 KB.`);
          setUploadReport([...report]);
          continue;
        }
        const value = await collectionRequest<{
          results: { ok: boolean; duplicate?: boolean; error?: string }[];
        }>(`/${id}/upload`, {
          files: [{ filename: file.name, source: await file.text() }],
        });
        const result = value.results[0];
        report.push(
          `${file.name}: ${result.ok ? (result.duplicate ? "already uploaded" : "uploaded") : result.error}`,
        );
        setUploadReport([...report]);
      }
      await refresh(id);
    });
  }
  async function startIndexing() {
    if (!page || scheduler.current) return;
    const id = page.collection.id;
    const controller = new AbortController();
    scheduler.current = controller;
    setProcessing(true);
    setError(null);
    try {
      while (!controller.signal.aborted) {
        const result = await collectionRequest<{ processed: number }>(
          `/${id}/process`,
          {},
          controller.signal,
        );
        await refresh(id, controller.signal);
        if (!result.processed) break;
      }
    } catch (error) {
      if (!controller.signal.aborted)
        setError(error instanceof Error ? error.message : "Indexing failed.");
    } finally {
      if (scheduler.current === controller) {
        scheduler.current = null;
        setProcessing(false);
      }
    }
  }
  const ready =
    page?.icons.filter((icon) => icon.status === "ready").length ?? 0;
  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <h2 className="text-2xl font-semibold">Private collections</h2>
      <p className="text-sm text-stone-600">
        Upload your own standalone SVGs. Start indexing when ready; processing
        pauses when you leave this page. No icons are imported automatically.
      </p>
      <form
        className="flex gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          void act(async () => {
            const created = await collectionRequest<{ id: string }>("", {
              name,
            });
            setName("");
            await refresh(created.id);
          });
        }}
      >
        <input
          aria-label="Collection name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          maxLength={80}
          placeholder="Collection name"
          className="rounded-lg border border-stone-300 bg-white px-3 py-2"
        />
        <button
          className={button}
          disabled={busy || processing || collections.length >= 5}
        >
          Create collection
        </button>
      </form>
      <div className="flex flex-wrap gap-2">
        {collections.map((collection) => (
          <button
            key={collection.id}
            className={button}
            disabled={busy || processing}
            onClick={() => void act(() => open(collection.id))}
          >
            {collection.name} · {collection.ready}/{collection.total} ready
          </button>
        ))}
      </div>
      {error && (
        <p role="alert" className="text-sm text-red-700">
          {error}
        </p>
      )}
      {page && (
        <section className="space-y-5 rounded-xl border border-stone-200 bg-white p-5">
          <div className="flex flex-wrap items-center gap-3">
            <h3 className="mr-auto text-lg font-semibold">
              {page.collection.name} · {ready}/{page.icons.length} searchable
            </h3>
            <button
              disabled={busy || processing}
              className={button}
              onClick={() => {
                if (
                  window.confirm(
                    "Delete this collection and all retained reference sources? Conversations remain private.",
                  )
                )
                  void act(async () => {
                    await collectionRequest(
                      `/${page.collection.id}`,
                      undefined,
                      undefined,
                      "DELETE",
                    );
                    setPage(null);
                    setRanking(null);
                    await refresh();
                  });
              }}
            >
              Delete collection
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <label className={button}>
              Select SVG files
              <input
                aria-label="Select SVG files"
                type="file"
                multiple
                accept=".svg,image/svg+xml"
                disabled={busy || processing}
                onChange={(e) => {
                  void upload(e.target.files);
                  e.target.value = "";
                }}
                className="ml-3 max-w-60 text-xs"
              />
            </label>
            <button
              className={button}
              disabled={
                busy ||
                processing ||
                !page.icons.some(
                  (icon) =>
                    ["pending", "described"].includes(icon.status) ||
                    !!icon.claimExpiresAt,
                )
              }
              onClick={() => void startIndexing()}
            >
              Start indexing / Resume
            </button>
            {processing && (
              <button
                className={button}
                onClick={() => scheduler.current?.abort()}
              >
                Pause
              </button>
            )}
            <button
              className={button}
              disabled={busy || processing}
              onClick={() => void act(() => refresh(page.collection.id))}
            >
              Refresh status
            </button>
          </div>
          {processing && (
            <p role="status" className="text-sm">
              Indexing batches of five · {ready}/{page.icons.length} ready.
              Pausing stops scheduling; an in-flight stage may finish or require
              explicit retry.
            </p>
          )}
          {uploadReport.length > 0 && (
            <ul className="text-xs text-stone-600">
              {uploadReport.map((line, i) => (
                <li key={i}>{line}</li>
              ))}
            </ul>
          )}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {page.icons.map((icon) => (
              <article
                key={icon.id}
                className="space-y-2 rounded-lg border border-stone-200 p-3"
              >
                <SvgImage source={icon.source} label={icon.filename} />
                <p className="break-all text-sm font-medium">{icon.filename}</p>
                <p className="text-xs">
                  {icon.status}
                  {icon.claimExpiresAt
                    ? " · processing / awaiting claim expiry"
                    : ""}{" "}
                  · description {icon.descriptionAttempts}/3 · embedding{" "}
                  {icon.embeddingAttempts}/3
                </p>
                <p className="text-xs text-stone-600">{icon.description}</p>
                <p className="text-xs text-stone-500">{icon.tags.join(", ")}</p>
                {icon.error && (
                  <p className="text-xs text-red-700">{icon.error}</p>
                )}
                <div className="flex flex-wrap gap-2">
                  {icon.status.endsWith("_error") && (
                    <button
                      className={button}
                      disabled={busy || processing}
                      onClick={() =>
                        void act(async () => {
                          await collectionRequest(
                            `/${page.collection.id}/retry`,
                            { iconId: icon.id },
                          );
                          await refresh(page.collection.id);
                        })
                      }
                    >
                      Retry failed stage
                    </button>
                  )}
                  {icon.status === "ready" && (
                    <button
                      className={button}
                      disabled={busy || processing}
                      onClick={() =>
                        void act(async () => {
                          await collectionRequest(
                            `/${page.collection.id}/retry`,
                            { iconId: icon.id, reindex: true },
                          );
                          await refresh(page.collection.id);
                        })
                      }
                    >
                      Reindex embedding
                    </button>
                  )}
                  <button
                    className={button}
                    disabled={busy || processing}
                    onClick={() => {
                      if (
                        window.confirm(
                          "Delete this icon and retained reference sources?",
                        )
                      )
                        void act(async () => {
                          await collectionRequest(
                            `/${page.collection.id}/delete-icon`,
                            { iconId: icon.id },
                          );
                          setRanking(null);
                          await refresh(page.collection.id);
                        });
                    }}
                  >
                    Delete
                  </button>
                </div>
                <details className="text-xs">
                  <summary>Recorded usage</summary>
                  <pre className="overflow-auto">
                    {JSON.stringify(icon.usage, null, 2)}
                  </pre>
                </details>
              </article>
            ))}
          </div>
          <form
            className="flex flex-wrap gap-3 border-t border-stone-200 pt-5"
            onSubmit={(event) => {
              event.preventDefault();
              void act(async () =>
                setRanking(
                  await collectionRequest<Retrieval>(
                    `/${page.collection.id}/search`,
                    { query },
                  ),
                ),
              );
            }}
          >
            <label
              className="w-full text-sm font-medium"
              htmlFor="retrieval-query"
            >
              Retrieval playground
            </label>
            <input
              id="retrieval-query"
              required
              maxLength={4001}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search your indexed icons"
              className="min-w-0 flex-1 rounded-lg border border-stone-300 px-3 py-2"
            />
            <button className={button} disabled={busy || processing || !ready}>
              Search
            </button>
          </form>
          {ranking && <RetrievalDetails detail={ranking} />}
        </section>
      )}
    </div>
  );
}
