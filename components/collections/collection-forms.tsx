"use client";
import { useState } from "react";
import type { Retrieval } from "@/lib/collections/contracts";
import { collectionRequest } from "./client";
import { RetrievalDetails } from "./retrieval-details";

export const collectionButton =
  "rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm disabled:opacity-40";
export type Act = (action: () => Promise<void>) => Promise<boolean>;
export function CreateCollection({
  disabled,
  onCreate,
}: {
  disabled: boolean;
  onCreate: (name: string, onSaved: () => void) => Promise<boolean>;
}) {
  const [name, setName] = useState("");
  return (
    <form
      className="flex gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        void onCreate(name, () => setName(""));
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
      <button className={collectionButton} disabled={disabled}>
        Create collection
      </button>
    </form>
  );
}

export function RetrievalPlayground({
  collectionId,
  disabled,
  act,
  version,
}: {
  collectionId: string;
  disabled: boolean;
  act: Act;
  version: string;
}) {
  const [query, setQuery] = useState("");
  const [ranking, setRanking] = useState<{
    version: string;
    detail: Retrieval;
  } | null>(null);
  return (
    <>
      <form
        className="flex flex-wrap gap-3 border-t border-stone-200 pt-5"
        onSubmit={(event) => {
          event.preventDefault();
          void act(async () =>
            setRanking({
              version,
              detail: await collectionRequest<Retrieval>(
                `/${collectionId}/search`,
                { query },
              ),
            }),
          );
        }}
      >
        <label className="w-full text-sm font-medium" htmlFor="retrieval-query">
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
        <button className={collectionButton} disabled={disabled}>
          Search
        </button>
      </form>
      {ranking?.version === version && (
        <RetrievalDetails detail={ranking.detail} />
      )}
    </>
  );
}
