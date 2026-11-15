"use client";

import {
  useCallback,
  useEffect,
  useReducer,
  useRef,
  useState,
  type SetStateAction,
} from "react";
import { useSavedConversation } from "./use-saved-conversation";
import type { DraftHandle } from "./workspace-draft";
import {
  createWorkspaceSessionState,
  workspaceSessionReducer,
} from "./workspace-session-state";
import {
  submissionSchema,
  type Submission,
  type ConversationPage,
} from "@/lib/conversations/contracts";
import {
  createConversation,
  loadConversation,
} from "@/lib/conversations/client";
import {
  GenerationRequestError,
  requestSavedSvgGenerationOnClient,
} from "@/lib/workspace/generate-client";
import { CLIENT_GENERATION_TIMEOUT_MS } from "@/lib/workspace/generation-limits";

export function useWorkspaceSession({
  routeId,
  onCreated,
}: {
  routeId: string | null;
  onCreated: (id: string) => void;
}) {
  const [state, dispatch] = useReducer(
    workspaceSessionReducer,
    routeId,
    createWorkspaceSessionState,
  );
  const [selectedCollection, setCollectionId] = useState("");
  const draft = useRef<DraftHandle>(null);
  // Async guards need the current identity/revision before React renders updates.
  const conversationId = useRef<string | null>(null);
  const revision = useRef(0);
  const activeRequest = useRef<AbortController | null>(null);
  const pendingCreation = useRef<{ id: string; content: string } | null>(null);

  const {
    savedConversation,
    messages,
    document,
    publicId,
    isSubmissionInProgress,
    isConversationStateConfirmed,
    preview,
    activity,
    generatedCharacters,
    error,
    olderCursor,
    isLoadingOlderMessages,
    historyRefresh,
    retryInput,
    retryAvailableAt,
  } = state;
  const displayedId = savedConversation?.id ?? null;
  const collectionId = savedConversation?.collectionId ?? selectedCollection;
  const isConversationPrivate = savedConversation?.private ?? false;
  const activeSavedRun = savedConversation?.activeRunId ?? null;
  const leaseExpiresAt = savedConversation?.leaseExpiresAt ?? null;
  const progress = generatedCharacters ?? 0;
  const isSvgGenerationInProgress = generatedCharacters !== null;

  const setSavedConversation = useCallback(
    (update: SetStateAction<ConversationPage["conversation"] | null>) => {
      dispatch({ type: "savedConversationUpdated", update });
    },
    [],
  );
  const setPublicId = useCallback((update: SetStateAction<string | null>) => {
    dispatch({ type: "publicIdUpdated", update });
  }, []);
  const reportWorkspaceError = useCallback((message: string) => {
    dispatch({ type: "workspaceErrorReported", message });
  }, []);

  const restoreSavedConversationState = useCallback(
    (
      page: ConversationPage,
      isMergingSavedMessages = false,
      unacceptedFailure?: {
        message: string;
        submissionKind: Submission["kind"];
      },
    ) => {
      conversationId.current = page.conversation.id;
      revision.current = page.conversation.revision;
      dispatch({
        type: "savedConversationRestored",
        page,
        isMergingSavedMessages,
        retryRequestId: crypto.randomUUID(),
        unacceptedFailure,
      });
    },
    [],
  );

  const prepareSavedLoad = useCallback(() => {
    activeRequest.current?.abort();
    activeRequest.current = null;
    dispatch({ type: "savedConversationLoadStarted" });
  }, []);
  const { isOpeningConversation, refresh: refreshSavedConversation } =
    useSavedConversation({
      routeId,
      conversationId,
      activeSavedRun,
      leaseExpiresAt,
      isSubmissionInProgress,
      onBeforeLoad: prepareSavedLoad,
      onRestore: restoreSavedConversationState,
      onError: reportWorkspaceError,
    });

  function restoreDraft(value: string) {
    draft.current?.restore(value);
  }

  async function olderMessages() {
    if (!conversationId.current || !olderCursor || isLoadingOlderMessages)
      return;
    const id = conversationId.current;
    dispatch({ type: "olderMessagesLoadStarted" });
    try {
      const page = await loadConversation(id, undefined, olderCursor);
      if (conversationId.current !== id) return;
      dispatch({ type: "olderMessagesPageReceived", page });
    } catch (error) {
      reportWorkspaceError(
        error instanceof Error
          ? error.message
          : "Earlier messages could not be loaded.",
      );
    } finally {
      dispatch({ type: "olderMessagesLoadingStopped" });
    }
  }

  async function ensureSavedConversation(content: string) {
    if (conversationId.current) return true;
    const controller = new AbortController();
    activeRequest.current = controller;
    dispatch({ type: "conversationCreationStarted" });
    pendingCreation.current =
      pendingCreation.current?.content === content
        ? pendingCreation.current
        : { id: crypto.randomUUID(), content };
    try {
      const saved = await createConversation(
        pendingCreation.current.id,
        content,
        controller.signal,
        collectionId || null,
      );
      if (activeRequest.current !== controller) return false;
      conversationId.current = saved.id;
      revision.current = saved.revision;
      dispatch({
        type: "conversationCreated",
        conversation: {
          ...saved,
          collectionId: collectionId || null,
          private: !!collectionId,
          activeRunId: null,
          leaseExpiresAt: null,
        },
      });
      // Adopt the URL without remounting this session or aborting its first run.
      onCreated(saved.id);
      window.history.replaceState(null, "", `/conversations/${saved.id}`);
      return true;
    } catch (error) {
      if (activeRequest.current === controller) {
        restoreDraft(content);
        reportWorkspaceError(
          error instanceof Error
            ? error.message
            : "Conversation could not be saved.",
        );
      }
      return false;
    } finally {
      if (activeRequest.current === controller) {
        activeRequest.current = null;
        dispatch({ type: "conversationCreationFinished" });
      }
    }
  }

  async function reconcileSavedConversation(
    submission: Submission,
    controller: AbortController,
    requestFailure: string | null,
  ) {
    // The saved result may have committed even if its terminal stream event was lost.
    const page = await loadConversation(submission.conversationId);
    if (activeRequest.current !== controller) return;
    restoreSavedConversationState(
      page,
      true,
      requestFailure
        ? {
            message: requestFailure,
            submissionKind: submission.kind,
          }
        : undefined,
    );
  }

  async function consumeSavedGeneration(
    submission: Submission,
    optimisticUserMessageId?: string,
  ) {
    if (activeRequest.current) return;
    const controller = new AbortController();
    activeRequest.current = controller;
    let replyId = crypto.randomUUID() as string;
    let isRequestAccepted = false;
    let isExcludedFromContext = false;
    let requestFailure: string | null = null;
    dispatch({ type: "generationRequestStarted", submission, replyId });
    const timeout = setTimeout(
      () => controller.abort(),
      CLIENT_GENERATION_TIMEOUT_MS,
    );
    try {
      await requestSavedSvgGenerationOnClient({
        submission,
        signal: controller.signal,
        onGenerationEvent: (event) => {
          if (activeRequest.current !== controller) return;
          dispatch({
            type: "generationEventReceived",
            event,
            receivedAt: Date.now(),
            replyId,
            optimisticUserMessageId,
          });
          if (event.type === "started") {
            isRequestAccepted = true;
            revision.current = event.revision;
            replyId = event.assistantMessageId;
          }
          if (event.type === "error")
            isExcludedFromContext = event.excludedFromContext ?? false;
        },
      });
    } catch (error) {
      if (activeRequest.current !== controller) return;
      const message = controller.signal.aborted
        ? "Generation was interrupted. Reopen the conversation to check its saved state."
        : error instanceof Error
          ? error.message
          : "Generation failed. Please retry.";
      const isConversationConflict =
        error instanceof GenerationRequestError && error.status === 409;
      dispatch({
        type: "generationRequestFailed",
        message,
        replyId,
        optimisticUserMessageId,
        isRequestAccepted,
        isConversationConflict,
        retryAvailableAt:
          !isConversationConflict && !isExcludedFromContext
            ? Date.now() + 15_000
            : null,
      });
      if (!isRequestAccepted) {
        requestFailure = message;
        if (submission.kind === "message") restoreDraft(submission.content);
      }
      if (isConversationConflict) void refreshSavedConversation();
    } finally {
      clearTimeout(timeout);
      if (activeRequest.current === controller) {
        try {
          await reconcileSavedConversation(
            submission,
            controller,
            requestFailure,
          );
        } catch {
          if (activeRequest.current === controller && isRequestAccepted) {
            dispatch({ type: "savedGenerationConfirmationFailed" });
          }
        }
        if (activeRequest.current === controller) {
          activeRequest.current = null;
          dispatch({ type: "generationRequestFinished" });
        }
      }
    }
  }

  async function sendMessage(content: string) {
    if (
      activeRequest.current ||
      isOpeningConversation ||
      activeSavedRun ||
      !isConversationStateConfirmed
    )
      return;
    const trimmed = content.trim();
    if (!trimmed || trimmed.length > 2000) return;
    if (!conversationId.current && !(await ensureSavedConversation(trimmed)))
      return;
    const parsed = submissionSchema.safeParse({
      kind: "message",
      conversationId: conversationId.current,
      content: trimmed,
      requestId: crypto.randomUUID(),
      expectedRevision: revision.current,
    });
    if (!parsed.success) {
      reportWorkspaceError("Your message could not be submitted.");
      restoreDraft(trimmed);
      return;
    }
    const optimisticUserMessageId = crypto.randomUUID();
    dispatch({
      type: "optimisticUserMessageAdded",
      id: optimisticUserMessageId,
      content: trimmed,
    });
    void consumeSavedGeneration(parsed.data, optimisticUserMessageId);
  }

  function retry() {
    if (!retryInput || Date.now() < retryAvailableAt) return;
    void consumeSavedGeneration(
      retryInput.kind === "retry"
        ? { ...retryInput, expectedRevision: revision.current }
        : retryInput,
    );
  }

  useEffect(
    () => () => {
      activeRequest.current?.abort();
      activeRequest.current = null;
    },
    [],
  );

  return {
    draft,
    collectionId,
    setCollectionId,
    isConversationPrivate,
    messages,
    document,
    publicId,
    isSubmissionInProgress,
    isOpeningConversation,
    displayedId,
    isConversationStateConfirmed,
    activeSavedRun,
    isSvgGenerationInProgress,
    preview,
    activity,
    progress,
    error,
    olderCursor,
    isLoadingOlderMessages,
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
