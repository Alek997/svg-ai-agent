"use client";
import { useId, useState } from "react";
import type { CollectionSummary } from "@/lib/collections/contracts";
import { useCollectionList } from "./use-collection-list";
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
  const { collections, error } = useCollectionList();
  const [expanded, setExpanded] = useState(false);
  const controlsId = useId();
  return (
    <div className="workspace-collections min-h-0 max-h-[30%] shrink-0 overflow-y-auto border-b border-stone-200 bg-white text-xs text-stone-600 lg:max-h-none">
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={controlsId}
        onClick={() => setExpanded((value) => !value)}
        className="min-h-10 w-full px-3 text-left font-medium lg:hidden"
      >
        {privateConversation
          ? "Private conversation · Collections"
          : "Reference collections"}
        <span className="float-right" aria-hidden="true">
          {expanded ? "−" : "+"}
        </span>
      </button>
      <div
        id={controlsId}
        className={`${expanded ? "block" : "hidden"} space-y-2 px-3 py-3 lg:block lg:px-6`}
      >
        {!conversationId ? (
          <label>
            Reference collection{" "}
            <select
              aria-label="Reference collection"
              className="block w-full max-w-full mt-2 text-base lg:text-xs sm:ml-3 sm:inline-block sm:w-auto sm:mt-0 rounded-lg border border-stone-200 px-3 py-2"
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
              Selection is fixed when the conversation starts. Using a
              collection makes all its artwork private.
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
          className="max-w-full text-base lg:text-xs rounded-lg border border-stone-200 px-3 py-2"
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
