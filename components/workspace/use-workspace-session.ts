"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSavedConversation } from "./use-saved-conversation";
import type { DraftHandle } from "./workspace-draft";
import {
  submissionSchema,
  type Submission,
  type ConversationPage,
} from "@/lib/conversations/contracts";
import {
  createConversation,
  loadConversation,
} from "@/lib/conversations/client";
import { applyEvent, finishDetails } from "@/lib/conversations/state";
import {
  GenerationRequestError,
  requestGeneration,
} from "@/lib/workspace/generate-client";
import { CLIENT_GENERATION_TIMEOUT_MS } from "@/lib/workspace/generation-limits";
import type { ChatMessage, SvgDocument } from "@/lib/workspace/types";

const welcome: ChatMessage = {
  id: "welcome",
  role: "assistant",
  content:
    "Describe an illustration, icon, or idea to create an SVG. After it’s ready, send a follow-up message to refine it.\n\nThe canvas starts with sample artwork for inspiration.",
};

export function useWorkspaceSession({
  routeId,
  onCreated,
}: {
  routeId: string | null;
  onCreated: (id: string) => void;
}) {
  const [selectedCollection, setCollectionId] = useState("");
  const [savedConversation, setSavedConversation] = useState<
    ConversationPage["conversation"] | null
  >(null);
  const displayedId = savedConversation?.id ?? null;
  const collectionId = savedConversation?.collectionId ?? selectedCollection;
  const privateConversation = savedConversation?.private ?? false;
  const activeSavedRun = savedConversation?.activeRunId ?? null;
  const leaseExpiresAt = savedConversation?.leaseExpiresAt ?? null;
  const [messages, setMessages] = useState<ChatMessage[]>(
    routeId ? [] : [welcome],
  );
  const [document, setDocument] = useState<SvgDocument | null>(null);
  const [publicId, setPublicId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [ready, setReady] = useState(!routeId);
  const [preview, setPreview] = useState<SvgDocument | null>(null);
  const [activity, setActivity] = useState("Starting generation…");
  const [generatedCharacters, setProgress] = useState<number | null>(null);
  const progress = generatedCharacters ?? 0;
  const isGenerating = generatedCharacters !== null;
  const [error, setError] = useState<string | null>(null);
  const draft = useRef<DraftHandle>(null);
  const setDraft = (value: string) => draft.current?.restore(value);
  const [olderCursor, setOlderCursor] = useState<number | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [historyRefresh, setHistoryRefresh] = useState(0);
  const [retryInput, setRetryInput] = useState<Submission | null>(null);
  const [retryAvailableAt, setRetryAvailableAt] = useState(0);
  const conversationId = useRef<string | null>(null);
  const revision = useRef(0);
  const activeRequest = useRef<AbortController | null>(null);
  const pendingCreation = useRef<{ id: string; content: string } | null>(null);

  const restore = useCallback((page: ConversationPage, merge = false) => {
    conversationId.current = page.conversation.id;
    setSavedConversation(page.conversation);
    revision.current = page.conversation.revision;
    setMessages((previous) =>
      merge
        ? [
            ...previous.filter(
              (message) =>
                message.id !== "welcome" &&
                message.position &&
                !page.messages.some((saved) => saved.id === message.id),
            ),
            ...page.messages,
          ].sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
        : page.messages,
    );
    setDocument(page.document);
    setPublicId(page.publicId);
    setPreview(null);
    if (!merge) setOlderCursor(page.olderCursor);
    setReady(true);
    const last = page.messages.at(-1);
    if (
      last &&
      ["error", "interrupted"].includes(last.runStatus) &&
      last.retryable
    ) {
      setRetryInput({
        kind: "retry",
        conversationId: page.conversation.id,
        retryOf: last.id,
        requestId: crypto.randomUUID(),
        expectedRevision: page.conversation.revision,
      });
      setError(last.runError ?? "Generation was interrupted. Please retry.");
    } else {
      setRetryInput(null);
      setError(null);
    }
  }, []);

  const prepareSavedLoad = useCallback(() => {
    activeRequest.current?.abort();
    activeRequest.current = null;
    setIsLoading(false);
    setProgress(null);
    setActivity("Starting generation…");
    setPreview(null);
    setReady(false);
    setError(null);
    setRetryInput(null);
    setRetryAvailableAt(0);
  }, []);
  const { opening, refresh: refreshSavedConversation } = useSavedConversation({
    routeId,
    conversationId,
    activeSavedRun,
    leaseExpiresAt,
    isLoading,
    onBeforeLoad: prepareSavedLoad,
    onRestore: restore,
    onError: setError,
  });
  useEffect(
    () => () => {
      activeRequest.current?.abort();
      activeRequest.current = null;
    },
    [],
  );
  async function olderMessages() {
    if (!conversationId.current || !olderCursor || loadingOlder) return;
    const id = conversationId.current;
    setLoadingOlder(true);
    try {
      const page = await loadConversation(id, undefined, olderCursor);
      if (conversationId.current !== id) return;
      setMessages((previous) => [
        ...page.messages.filter(
          (message) => !previous.some((saved) => saved.id === message.id),
        ),
        ...previous.filter((message) => message.id !== "welcome"),
      ]);
      setOlderCursor(page.olderCursor);
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Earlier messages could not be loaded.",
      );
    } finally {
      setLoadingOlder(false);
    }
  }

  async function generate(input: Submission, optimisticUserId?: string) {
    if (activeRequest.current) return;
    const controller = new AbortController();
    activeRequest.current = controller;
    let replyId = crypto.randomUUID() as string;
    let accepted = false;
    let excluded = false;
    let requestFailure: string | null = null;
    setMessages((previous) => [
      ...previous,
      {
        id: replyId,
        role: "assistant",
        content: "",
        flow: [],
        tools: [],
        steps: [],
        runStatus: "running",
      },
    ]);
    setRetryInput(input);
    setRetryAvailableAt(0);
    setIsLoading(true);
    setProgress(null);
    setPreview(null);
    setActivity("Saving your message…");
    setError(null);
    const timeout = setTimeout(
      () => controller.abort(),
      CLIENT_GENERATION_TIMEOUT_MS,
    );
    try {
      await requestGeneration(input, controller.signal, (event) => {
        if (activeRequest.current !== controller) return;
        if (event.type === "started") {
          accepted = true;
          revision.current = event.revision;
          const oldReplyId = replyId;
          replyId = event.assistantMessageId;
          setMessages((previous) =>
            previous.map((message) =>
              message.id === oldReplyId
                ? { ...message, id: replyId }
                : message.id === optimisticUserId
                  ? { ...message, id: event.userMessageId }
                  : message,
            ),
          );
          setActivity("Checking your request…");
          return;
        }
        setMessages((previous) =>
          previous.map((message) =>
            message.id === replyId ? applyEvent(message, event) : message,
          ),
        );
        if (event.type === "preview")
          setPreview({
            name: "draft.svg",
            description: "SVG in progress",
            ...event.svg,
          });
        if (event.type === "activity")
          setActivity(
            `Step ${event.step}/6 · ${event.action === "webSearch" ? "Searching for references…" : event.action === "querySvg" ? "Reading current SVG…" : event.action === "validateSvg" ? "Drawing and checking SVG…" : "Working…"}`,
          );
        if (event.type === "progress") {
          setProgress(event.characters);
        }
        if (event.type === "result") {
          setDocument(event.document);
          setPublicId(null);
          setPreview(null);
          setRetryInput(null);
        }
        if (event.type === "reply") setRetryInput(null);
        if (event.type === "error") {
          excluded = event.excludedFromContext ?? false;
          if (event.retryable === false) setRetryInput(null);
        }
      });
    } catch (error) {
      if (activeRequest.current !== controller) return;
      const text = controller.signal.aborted
        ? "Generation was interrupted. Reopen the conversation to check its saved state."
        : error instanceof Error
          ? error.message
          : "Generation failed. Please retry.";
      setError(text);
      setMessages((previous) =>
        previous.map((message) =>
          message.id === replyId
            ? finishDetails({ ...message, runStatus: "error", runError: text })
            : message,
        ),
      );
      if (!accepted) {
        requestFailure = text;
        setMessages((previous) =>
          previous.filter(
            (message) =>
              message.id !== replyId && message.id !== optimisticUserId,
          ),
        );
        if (input.kind === "message") setDraft(input.content);
      }
      if (error instanceof GenerationRequestError && error.status === 409) {
        setRetryInput(null);
        void refreshSavedConversation();
      } else if (!excluded) {
        setRetryAvailableAt(Date.now() + 15_000);
      }
    } finally {
      clearTimeout(timeout);
      if (activeRequest.current === controller) {
        // Refresh canonical IDs/details, including success if its last stream event was lost.
        try {
          const page = await loadConversation(input.conversationId);
          if (activeRequest.current === controller) {
            restore(page, true);
            if (requestFailure) {
              setError(requestFailure);
              if (input.kind === "message") setRetryInput(null);
            }
          }
        } catch {
          if (activeRequest.current === controller && accepted) {
            setReady(false);
            setRetryInput(null);
            setError(
              "Unable to confirm saved state. Reopen this conversation before continuing.",
            );
          }
        }
        if (activeRequest.current === controller) {
          activeRequest.current = null;
          setIsLoading(false);
          setProgress(null);
          setPreview(null);
          setHistoryRefresh((value) => value + 1);
        }
      }
    }
  }
  async function sendMessage(content: string) {
    if (activeRequest.current || opening || activeSavedRun || !ready) return;
    const trimmed = content.trim();
    if (!trimmed || trimmed.length > 2000) return;
    if (!conversationId.current) {
      const controller = new AbortController();
      activeRequest.current = controller;
      setIsLoading(true);
      setError(null);
      pendingCreation.current =
        pendingCreation.current?.content === trimmed
          ? pendingCreation.current
          : { id: crypto.randomUUID(), content: trimmed };
      try {
        const saved = await createConversation(
          pendingCreation.current.id,
          trimmed,
          controller.signal,
          collectionId || null,
        );
        if (activeRequest.current !== controller) return;
        conversationId.current = saved.id;
        revision.current = saved.revision;
        setSavedConversation({
          ...saved,
          collectionId: collectionId || null,
          private: !!collectionId,
          activeRunId: null,
          leaseExpiresAt: null,
        });
        onCreated(saved.id);
        window.history.replaceState(null, "", `/conversations/${saved.id}`);
        setHistoryRefresh((value) => value + 1);
      } catch (error) {
        if (activeRequest.current === controller) {
          setDraft(trimmed);
          setError(
            error instanceof Error
              ? error.message
              : "Conversation could not be saved.",
          );
        }
        return;
      } finally {
        if (activeRequest.current === controller) {
          activeRequest.current = null;
          setIsLoading(false);
        }
      }
    }
    const parsed = submissionSchema.safeParse({
      kind: "message",
      conversationId: conversationId.current,
      content: trimmed,
      requestId: crypto.randomUUID(),
      expectedRevision: revision.current,
    });
    if (!parsed.success) {
      setError("Your message could not be submitted.");
      setDraft(trimmed);
      return;
    }
    const userId = crypto.randomUUID();
    setMessages((previous) => [
      ...previous.filter((message) => message.id !== "welcome"),
      { id: userId, role: "user", content: trimmed },
    ]);
    void generate(parsed.data, userId);
  }
  function retry() {
    if (!retryInput || Date.now() < retryAvailableAt) return;
    void generate(
      retryInput.kind === "retry"
        ? { ...retryInput, expectedRevision: revision.current }
        : retryInput,
    );
  }
  return {
    draft,
    collectionId,
    setCollectionId,
    privateConversation,
    messages,
    document,
    publicId,
    isLoading,
    opening,
    displayedId,
    ready,
    activeSavedRun,
    isGenerating,
    preview,
    activity,
    progress,
    error,
    olderCursor,
    loadingOlder,
    historyRefresh,
    retryInput,
    retryAvailableAt,
    refreshSavedConversation,
    olderMessages,
    sendMessage,
    retry,
    setSavedConversation,
    setPublicId,
    abort: () => activeRequest.current?.abort(),
  };
}
