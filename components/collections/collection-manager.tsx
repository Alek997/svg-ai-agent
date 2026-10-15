"use client";
import { useEffect, useState } from "react";
import type { CollectionSummary } from "@/lib/collections/contracts";
import { collectionRequest } from "./client";
import {
  CreateCollection,
  collectionButton as button,
} from "./collection-forms";
import { SelectedCollection, type CollectionPage } from "./selected-collection";

export function CollectionManager() {
  const [collections, setCollections] = useState<CollectionSummary[]>([]);
  const [selection, setSelection] = useState<{
    page: CollectionPage;
    version: number;
  } | null>(null);
  const page = selection?.page ?? null;
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [processing, setProcessing] = useState(false);
  async function refresh(id?: string, signal?: AbortSignal, opened = false) {
    const listed = await collectionRequest<{
      collections: CollectionSummary[];
    }>("", undefined, signal);
    if (signal?.aborted) return;
    setCollections(listed.collections);
    if (id) {
      const page = await collectionRequest<CollectionPage>(
        `/${id}`,
        undefined,
        signal,
      );
      if (signal?.aborted) return;
      setSelection((previous) => ({
        page,
        version: (previous?.version ?? 0) + (opened ? 1 : 0),
      }));
    }
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
    };
  }, []);
  async function act(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      return true;
    } catch (error) {
      setError(error instanceof Error ? error.message : "Request failed.");
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function open(id: string) {
    await refresh(id, undefined, true);
  }
  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <h2 className="text-2xl font-semibold">Private collections</h2>
      <p className="text-sm text-stone-600">
        Upload your own standalone SVGs. Start indexing when ready; processing
        pauses when you leave this page. No icons are imported automatically.
      </p>
      <CreateCollection
        disabled={busy || processing || collections.length >= 5}
        onCreate={(name, onSaved) =>
          act(async () => {
            const created = await collectionRequest<{ id: string }>("", {
              name,
            });
            onSaved();
            await refresh(created.id, undefined, true);
          })
        }
      />
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
        <SelectedCollection
          page={page}
          selectionVersion={selection!.version}
          busy={busy}
          act={act}
          refresh={refresh}
          onDeleted={() => setSelection(null)}
          onProcessing={(value) => {
            setProcessing(value);
            if (value) setError(null);
          }}
        />
      )}
    </div>
  );
}
