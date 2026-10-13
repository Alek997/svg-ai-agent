"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import { loadConversation } from "@/lib/conversations/client";
import {
  RUN_LEASE_MS,
  type ConversationPage,
} from "@/lib/conversations/contracts";
import { GenerationRequestError } from "@/lib/workspace/generate-client";

export function useSavedConversation({
  routeId,
  conversationId,
  activeSavedRun,
  leaseExpiresAt,
  isLoading,
  onBeforeLoad,
  onRestore,
  onError,
}: {
  routeId: string | null;
  conversationId: RefObject<string | null>;
  activeSavedRun: string | null;
  leaseExpiresAt: string | null;
  isLoading: boolean;
  onBeforeLoad: () => void;
  onRestore: (page: ConversationPage) => void;
  onError: (message: string) => void;
}) {
  const [opening, setOpening] = useState(!!routeId);
  const openRequest = useRef<AbortController | null>(null);
  const refresh = useCallback(async () => {
    if (!routeId) return;
    openRequest.current?.abort();
    const controller = new AbortController();
    openRequest.current = controller;
    // Defer setup so the first Strict Mode cleanup can abort before loading.
    await Promise.resolve().then(async () => {
      if (controller.signal.aborted) return;
      onBeforeLoad();
      setOpening(true);
      try {
        const page = await loadConversation(routeId, controller.signal);
        if (!controller.signal.aborted) onRestore(page);
      } catch (error) {
        if (controller.signal.aborted) return;
        if (
          error instanceof GenerationRequestError &&
          (error.status === 403 || error.status === 404)
        ) {
          window.history.replaceState(null, "", "/");
          return;
        }
        onError(
          error instanceof Error
            ? error.message
            : "Conversation could not be opened.",
        );
      } finally {
        if (!controller.signal.aborted) setOpening(false);
      }
    });
  }, [routeId, onBeforeLoad, onRestore, onError]);
  useEffect(() => {
    // Adopting a just-created conversation must not abort its first generation.
    if (!routeId || routeId === conversationId.current) return;
    void refresh();
    return () => openRequest.current?.abort();
  }, [routeId, conversationId, refresh]);
  useEffect(() => () => openRequest.current?.abort(), []);
  useEffect(() => {
    if (!activeSavedRun || isLoading || !routeId) return;
    const timer = setTimeout(
      () => void refresh(),
      Math.min(
        RUN_LEASE_MS + 1000,
        Math.max(
          1000,
          new Date(leaseExpiresAt ?? "").getTime() - Date.now() + 1000,
        ) || RUN_LEASE_MS,
      ),
    );
    return () => clearTimeout(timer);
  }, [activeSavedRun, leaseExpiresAt, isLoading, routeId, refresh]);
  return { opening, refresh };
}
