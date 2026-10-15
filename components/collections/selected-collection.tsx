"use client";
import { useEffect, useRef, useState } from "react";
import type { CollectionIcon } from "@/lib/collections/contracts";
import { collectionRequest } from "./client";
import {
  collectionButton as button,
  RetrievalPlayground,
  type Act,
} from "./collection-forms";
import { CollectionIconCard } from "./collection-icon-card";

export type CollectionPage = {
  collection: { id: string; name: string };
  icons: CollectionIcon[];
};
export function SelectedCollection({
  page,
  selectionVersion,
  busy,
  act,
  refresh,
  onDeleted,
  onProcessing,
}: {
  page: CollectionPage;
  selectionVersion: number;
  busy: boolean;
  act: Act;
  refresh: (id?: string, signal?: AbortSignal) => Promise<void>;
  onDeleted: () => void;
  onProcessing: (value: boolean) => void;
}) {
  const [processing, setProcessing] = useState(false);
  const [uploadReport, setUploadReport] = useState<string[]>([]);
  const [rankingVersion, setRankingVersion] = useState(0);
  const scheduler = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      scheduler.current?.abort();
    },
    [page.collection.id],
  );
  async function upload(files: FileList | null) {
    if (!files) return;
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
    if (scheduler.current) return;
    const id = page.collection.id;
    const controller = new AbortController();
    scheduler.current = controller;
    setProcessing(true);
    onProcessing(true);
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
        await act(async () => {
          throw error;
        });
    } finally {
      if (scheduler.current === controller) {
        scheduler.current = null;
        setProcessing(false);
        onProcessing(false);
      }
    }
  }
  const ready = page.icons.filter((icon) => icon.status === "ready").length;
  return (
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
                onDeleted();
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
          <button className={button} onClick={() => scheduler.current?.abort()}>
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
          Indexing batches of five · {ready}/{page.icons.length} ready. Pausing
          stops scheduling; an in-flight stage may finish or require explicit
          retry.
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
          <CollectionIconCard
            key={icon.id}
            icon={icon}
            disabled={busy || processing}
            onRetry={(reindex) =>
              void act(async () => {
                await collectionRequest(`/${page.collection.id}/retry`, {
                  iconId: icon.id,
                  ...(reindex ? { reindex: true } : {}),
                });
                await refresh(page.collection.id);
              })
            }
            onDelete={() => {
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
                  setRankingVersion((value) => value + 1);
                  await refresh(page.collection.id);
                });
            }}
          />
        ))}
      </div>
      <RetrievalPlayground
        version={`${selectionVersion}:${rankingVersion}`}
        collectionId={page.collection.id}
        disabled={busy || processing || !ready}
        act={act}
      />
    </section>
  );
}
