"use client";

import { useEffect, useState } from "react";
import { listConversations } from "@/lib/conversations/client";

type Item = Awaited<
  ReturnType<typeof listConversations>
>["conversations"][number];

export function useConversationList({
  includeArtwork = false,
  refreshKey = 0,
  initialError,
  paginationError = initialError,
}: {
  includeArtwork?: boolean;
  refreshKey?: number;
  initialError: string;
  paginationError?: string;
}) {
  const [items, setItems] = useState<Item[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(includeArtwork);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void listConversations(controller.signal, undefined, includeArtwork)
      .then((page) => {
        if (controller.signal.aborted) return;
        setItems(page.conversations);
        setCursor(page.nextCursor);
        setError(null);
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setError(error instanceof Error ? error.message : initialError);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [includeArtwork, initialError, refreshKey, reload]);
  async function loadMore() {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await listConversations(undefined, cursor, includeArtwork);
      setItems((previous) => [
        ...previous,
        ...page.conversations.filter(
          (item) => !previous.some((saved) => saved.id === item.id),
        ),
      ]);
      setCursor(page.nextCursor);
      setError(null);
    } catch (error) {
      setError(error instanceof Error ? error.message : paginationError);
    } finally {
      setLoadingMore(false);
    }
  }
  function reloadList() {
    if (includeArtwork) setLoading(true);
    setReload((value) => value + 1);
  }
  return { items, cursor, loading, loadingMore, error, loadMore, reloadList };
}
