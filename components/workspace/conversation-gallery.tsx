"use client";

import Link from "next/link";
import { useConversationList } from "./use-conversation-list";
import { useSvgBlobRef } from "@/lib/workspace/use-svg-blob-ref";
import type { SvgDocument } from "@/lib/workspace/types";

function Artwork({ document }: { document: SvgDocument }) {
  const image = useSvgBlobRef<HTMLImageElement>(document.source, "src");
  // The API validates stored SVG; image rendering keeps it outside the page DOM.
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      ref={image}
      alt={document.description}
      width={document.width}
      height={document.height}
      className="h-full w-full object-contain p-8"
    />
  );
}
export function ConversationGallery() {
  const { items, cursor, loading, loadingMore, error, loadMore, reloadList } =
    useConversationList({
      includeArtwork: true,
      initialError: "Your artwork could not be loaded.",
      paginationError: "More conversations could not be loaded.",
    });
  return (
    <div className="mx-auto w-full max-w-6xl px-5 py-10 sm:px-8">
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">My SVGs</h2>
          <p className="mt-2 text-sm text-stone-500">
            Your saved artwork and conversations. Open one to keep creating.
          </p>
        </div>
        <Link
          href="/"
          className="rounded-lg bg-stone-900 px-4 py-2.5 text-sm text-white"
        >
          Create an SVG
        </Link>
      </div>
      {error && (
        <div
          role="alert"
          className="mb-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800"
        >
          {error}{" "}
          <button
            type="button"
            onClick={() => {
              if (items.length) void loadMore();
              else reloadList();
            }}
            className="ml-2 underline"
          >
            Try again
          </button>
        </div>
      )}
      {loading ? (
        <div
          role="status"
          aria-label="Loading saved conversations"
          aria-busy="true"
          className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3"
        >
          <span className="sr-only">Loading your saved conversations…</span>
          {[0, 1, 2, 3, 4, 5].map((index) => (
            <div
              key={index}
              aria-hidden="true"
              className="h-72 animate-pulse rounded-2xl bg-stone-200/70 motion-reduce:animate-none"
            />
          ))}
        </div>
      ) : !items.length && !error ? (
        <div className="rounded-2xl border border-dashed border-stone-300 bg-white px-6 py-16 text-center">
          <h3 className="font-medium">Your gallery starts here</h3>
          <p className="mt-2 text-sm text-stone-500">
            Create your first SVG and it will be saved here automatically.
          </p>
          <Link
            href="/"
            className="mt-6 inline-block text-sm font-medium underline"
          >
            Create your first SVG
          </Link>
        </div>
      ) : (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((item) => (
            <Link
              key={item.id}
              href={`/conversations/${item.id}`}
              className="group overflow-hidden rounded-2xl border border-stone-200 bg-white transition-shadow hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-stone-700"
            >
              <div className="canvas-grid flex aspect-[4/3] items-center justify-center overflow-hidden border-b border-stone-200">
                {item.document ? (
                  <Artwork document={item.document} />
                ) : (
                  <span className="text-sm text-stone-400">No artwork yet</span>
                )}
              </div>
              <div className="p-5">
                <h3
                  className="truncate text-sm font-medium text-stone-800"
                  title={item.title}
                >
                  {item.title}
                </h3>
                <p className="mt-2 text-xs text-stone-500">
                  {item.document?.name ?? "Saved conversation"}
                </p>
                <time
                  dateTime={item.updatedAt}
                  className="mt-3 block text-xs text-stone-400"
                >
                  Updated {new Date(item.updatedAt).toLocaleDateString()}
                </time>
              </div>
            </Link>
          ))}
        </div>
      )}
      {!loading && cursor && (
        <div className="mt-8 text-center">
          <button
            type="button"
            onClick={() => void loadMore()}
            disabled={loadingMore}
            className="rounded-lg border border-stone-200 bg-white px-5 py-2.5 text-sm disabled:opacity-50"
          >
            {loadingMore ? "Loading…" : "Load more conversations"}
          </button>
        </div>
      )}
    </div>
  );
}
