"use client";
import { useEffect, useState } from "react";
import { listConversations } from "@/lib/conversations/client";
import type { z } from "zod";
import type { conversationSummarySchema } from "@/lib/conversations/contracts";

type Summary = z.infer<typeof conversationSummarySchema>;
export function ConversationHistory({
  currentId,
  refreshKey,
  onOpen,
}: {
  currentId: string | null;
  refreshKey: number;
  onOpen: (id: string) => void;
}) {
  const [items, setItems] = useState<Summary[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void listConversations(controller.signal)
      .then((page) => {
        setItems(page.conversations);
        setCursor(page.nextCursor);
        setError(null);
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setError(
            error instanceof Error
              ? error.message
              : "History could not be loaded.",
          );
      });
    return () => controller.abort();
  }, [refreshKey, reload]);
  async function loadMore() {
    if (!cursor || loading) return;
    setLoading(true);
    try {
      const page = await listConversations(undefined, cursor);
      setItems((previous) => [
        ...previous,
        ...page.conversations.filter(
          (item) => !previous.some((saved) => saved.id === item.id),
        ),
      ]);
      setCursor(page.nextCursor);
      setError(null);
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "History could not be loaded.",
      );
    } finally {
      setLoading(false);
    }
  }
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
            disabled={loading}
            className="px-2 py-2 underline"
          >
            {loading ? "Loading…" : "More conversations"}
          </button>
        )}
        {error && (
          <p role="alert" className="text-red-700">
            {error}{" "}
            <button
              type="button"
              onClick={() => setReload((value) => value + 1)}
              className="underline"
            >
              Retry loading history
            </button>
          </p>
        )}
      </nav>
    </details>
  );
}
