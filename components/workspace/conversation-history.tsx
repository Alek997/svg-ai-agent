"use client";

import { useConversationList } from "./use-conversation-list";

export function ConversationHistory({
  currentId,
  refreshKey,
  onOpen,
}: {
  currentId: string | null;
  refreshKey: number;
  onOpen: (id: string) => void;
}) {
  const { items, cursor, error, loadingMore, loadMore, reloadList } =
    useConversationList({
      refreshKey,
      initialError: "History could not be loaded.",
    });
  return (
    <details className="border-b border-stone-200 px-5 py-3 text-xs">
      <summary className="cursor-pointer font-medium text-stone-600">
        Saved conversations
      </summary>
      <nav
        aria-label="Saved conversations"
        className="mt-3 max-h-48 space-y-1 overflow-auto"
      >
        {!items.length && !error && (
          <p className="py-2 text-stone-400">
            Your first conversation will appear here.
          </p>
        )}
        {items.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => onOpen(item.id)}
            aria-current={item.id === currentId ? "page" : undefined}
            className={`block w-full truncate rounded-md px-2 py-2 text-left ${item.id === currentId ? "bg-stone-100 text-stone-900" : "text-stone-500 hover:bg-stone-50"}`}
            title={item.title}
          >
            {item.title}
          </button>
        ))}
        {cursor && (
          <button
            type="button"
            onClick={loadMore}
            disabled={loadingMore}
            className="px-2 py-2 underline"
          >
            {loadingMore ? "Loading…" : "More conversations"}
          </button>
        )}
        {error && (
          <p role="alert" className="text-red-700">
            {error}{" "}
            <button type="button" onClick={reloadList} className="underline">
              Retry loading history
            </button>
          </p>
        )}
      </nav>
    </details>
  );
}
