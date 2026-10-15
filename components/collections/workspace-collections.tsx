"use client";
import { useEffect, useState } from "react";
import type { CollectionSummary } from "@/lib/collections/contracts";
import { collectionRequest } from "./client";

export function WorkspaceCollections({
  conversationId,
  hasArtwork,
  privateConversation,
  selected,
  onSelect,
  onAdded,
  disabled,
}: {
  conversationId: string | null;
  hasArtwork: boolean;
  privateConversation: boolean;
  selected: string;
  onSelect: (value: string) => void;
  onAdded: () => void;
  disabled: boolean;
}) {
  const [collections, setCollections] = useState<CollectionSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
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
    return () => controller.abort();
  }, []);
  return (
    <div className="shrink-0 space-y-2 border-b border-stone-200 bg-white px-6 py-3 text-xs text-stone-600">
      {!conversationId ? (
        <label>
          Reference collection{" "}
          <select
            aria-label="Reference collection"
            className="ml-3 rounded-lg border border-stone-200 px-3 py-2"
            value={selected}
            disabled={disabled}
            onChange={(e) => onSelect(e.target.value)}
          >
            <option value="">None</option>
            {collections.map((collection) => (
              <option
                key={collection.id}
                value={collection.id}
                disabled={!collection.ready}
              >
                {collection.name} · {collection.ready} ready
              </option>
            ))}
          </select>
          <span className="ml-3">
            Selection is fixed when the conversation starts. Using a collection
            makes all its artwork private.
          </span>
        </label>
      ) : (
        <p>
          {privateConversation
            ? "Private conversation · public links are disabled."
            : "Reference selection is fixed for this conversation."}
        </p>
      )}
      {conversationId && hasArtwork && (
        <AddToCollection
          collections={collections}
          conversationId={conversationId}
          disabled={disabled}
          onAdded={onAdded}
        />
      )}
      {error && (
        <p role="alert" className="text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}

function AddToCollection({
  collections,
  conversationId,
  disabled,
  onAdded,
}: {
  collections: CollectionSummary[];
  conversationId: string;
  disabled: boolean;
  onAdded: () => void;
}) {
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function add() {
    if (!conversationId || !target) return;
    setBusy(true);
    setError(null);
    try {
      await collectionRequest(`/${target}/add-result`, { conversationId });
      onAdded();
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Adding artwork failed.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <select
          aria-label="Add artwork to collection"
          className="rounded-lg border border-stone-200 px-3 py-2"
          value={target}
          disabled={disabled || busy}
          onChange={(e) => setTarget(e.target.value)}
        >
          <option value="">Choose collection</option>
          {collections.map((collection) => (
            <option key={collection.id} value={collection.id}>
              {collection.name}
            </option>
          ))}
        </select>
        <button
          className="rounded-lg border border-stone-200 px-3 py-2"
          disabled={!target || disabled || busy}
          onClick={() => void add()}
        >
          {busy ? "Adding…" : "Add to collection"}
        </button>
        <span>
          Copies the saved artwork for indexing. Makes this conversation
          permanently private and revokes all public links.
        </span>
      </div>
      {error && (
        <p role="alert" className="text-red-700">
          {error}
        </p>
      )}
    </>
  );
}
