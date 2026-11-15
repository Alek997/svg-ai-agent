import type { SetStateAction } from "react";
import type {
  ConversationPage,
  Submission,
} from "@/lib/conversations/contracts";
import { applyEvent, finishDetails } from "@/lib/conversations/state";
import type { GenerationEvent } from "@/lib/workspace/contracts";
import type { ChatMessage, SvgDocument } from "@/lib/workspace/types";

type SavedConversation = ConversationPage["conversation"] | null;

export type WorkspaceSessionState = {
  savedConversation: SavedConversation;
  messages: ChatMessage[];
  document: SvgDocument | null;
  publicId: string | null;
  isSubmissionInProgress: boolean;
  // A failed canonical reload can leave an idle session unsafe to submit to.
  isConversationStateConfirmed: boolean;
  preview: SvgDocument | null;
  activity: string;
  generatedCharacters: number | null;
  error: string | null;
  olderCursor: number | null;
  isLoadingOlderMessages: boolean;
  historyRefresh: number;
  retryInput: Submission | null;
  retryAvailableAt: number;
};

export type WorkspaceSessionAction =
  | { type: "savedConversationLoadStarted" }
  | {
      type: "savedConversationRestored";
      page: ConversationPage;
      isMergingSavedMessages: boolean;
      retryRequestId: string;
      unacceptedFailure?: {
        message: string;
        submissionKind: Submission["kind"];
      };
    }
  | { type: "olderMessagesLoadStarted" }
  | { type: "olderMessagesPageReceived"; page: ConversationPage }
  | { type: "olderMessagesLoadingStopped" }
  | { type: "conversationCreationStarted" }
  | {
      type: "conversationCreated";
      conversation: NonNullable<SavedConversation>;
    }
  | { type: "conversationCreationFinished" }
  | { type: "optimisticUserMessageAdded"; id: string; content: string }
  | {
      type: "generationRequestStarted";
      submission: Submission;
      replyId: string;
    }
  | {
      type: "generationEventReceived";
      event: GenerationEvent;
      receivedAt: number;
      replyId: string;
      optimisticUserMessageId?: string;
    }
  | {
      type: "generationRequestFailed";
      message: string;
      replyId: string;
      optimisticUserMessageId?: string;
      isRequestAccepted: boolean;
      isConversationConflict: boolean;
      retryAvailableAt: number | null;
    }
  | { type: "savedGenerationConfirmationFailed" }
  | { type: "generationRequestFinished" }
  | { type: "workspaceErrorReported"; message: string }
  // Preserve the hook's existing React setter interface, including updater functions.
  | {
      type: "savedConversationUpdated";
      update: SetStateAction<SavedConversation>;
    }
  | { type: "publicIdUpdated"; update: SetStateAction<string | null> };

const welcomeMessage: ChatMessage = {
  id: "welcome",
  role: "assistant",
  content:
    "Describe an illustration, icon, or idea to create an SVG. After it’s ready, send a follow-up message to refine it.\n\nThe canvas starts with sample artwork for inspiration.",
};

export function createWorkspaceSessionState(
  routeId: string | null,
): WorkspaceSessionState {
  return {
    savedConversation: null,
    messages: routeId ? [] : [welcomeMessage],
    document: null,
    publicId: null,
    isSubmissionInProgress: false,
    isConversationStateConfirmed: !routeId,
    preview: null,
    activity: "Starting generation…",
    generatedCharacters: null,
    error: null,
    olderCursor: null,
    isLoadingOlderMessages: false,
    historyRefresh: 0,
    retryInput: null,
    retryAvailableAt: 0,
  };
}

function mergeCanonicalMessages(previous: ChatMessage[], saved: ChatMessage[]) {
  return [
    ...previous.filter(
      (message) =>
        message.id !== "welcome" &&
        message.position &&
        !saved.some((item) => item.id === message.id),
    ),
    ...saved,
  ].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
}

function restoreSavedConversation(
  state: WorkspaceSessionState,
  action: Extract<
    WorkspaceSessionAction,
    { type: "savedConversationRestored" }
  >,
): WorkspaceSessionState {
  const { page, isMergingSavedMessages, retryRequestId, unacceptedFailure } =
    action;
  const last = page.messages.at(-1);
  const isLastSavedAttemptRetryable =
    !!last &&
    ["error", "interrupted"].includes(last.runStatus) &&
    last.retryable;
  const retryInput: Submission | null = isLastSavedAttemptRetryable
    ? {
        kind: "retry",
        conversationId: page.conversation.id,
        retryOf: last.id,
        requestId: retryRequestId,
        expectedRevision: page.conversation.revision,
      }
    : null;
  return {
    ...state,
    savedConversation: page.conversation,
    messages: isMergingSavedMessages
      ? mergeCanonicalMessages(state.messages, page.messages)
      : page.messages,
    document: page.document,
    publicId: page.publicId,
    preview: null,
    olderCursor: isMergingSavedMessages ? state.olderCursor : page.olderCursor,
    isConversationStateConfirmed: true,
    retryInput:
      unacceptedFailure?.submissionKind === "message" ? null : retryInput,
    error:
      unacceptedFailure?.message ??
      (isLastSavedAttemptRetryable
        ? (last.runError ?? "Generation was interrupted. Please retry.")
        : null),
  };
}

function describeGenerationActivity(
  event: Extract<GenerationEvent, { type: "activity" }>,
) {
  const descriptions = {
    webSearch: "Searching for references…",
    querySvg: "Reading current SVG…",
    validateSvg: "Drawing and checking SVG…",
    working: "Working…",
  };
  return `Step ${event.step}/6 · ${descriptions[event.action]}`;
}

function applyGenerationEvent(
  state: WorkspaceSessionState,
  {
    event,
    receivedAt,
    replyId,
    optimisticUserMessageId,
  }: Extract<WorkspaceSessionAction, { type: "generationEventReceived" }>,
): WorkspaceSessionState {
  if (event.type === "started") {
    return {
      ...state,
      messages: state.messages.map((message) =>
        message.id === replyId
          ? { ...message, id: event.assistantMessageId }
          : message.id === optimisticUserMessageId
            ? { ...message, id: event.userMessageId }
            : message,
      ),
      activity: "Checking your request…",
    };
  }
  const next = {
    ...state,
    messages: state.messages.map((message) =>
      message.id === replyId ? applyEvent(message, event, receivedAt) : message,
    ),
  };
  switch (event.type) {
    case "preview":
      return {
        ...next,
        preview: {
          name: "draft.svg",
          description: "SVG in progress",
          ...event.svg,
        },
      };
    case "activity":
      return { ...next, activity: describeGenerationActivity(event) };
    case "progress":
      return { ...next, generatedCharacters: event.characters };
    case "result":
      return {
        ...next,
        document: event.document,
        publicId: null,
        preview: null,
        retryInput: null,
      };
    case "reply":
      return { ...next, retryInput: null };
    case "error":
      return {
        ...next,
        retryInput: event.retryable === false ? null : next.retryInput,
      };
    default:
      return next;
  }
}

function applyGenerationFailure(
  state: WorkspaceSessionState,
  action: Extract<WorkspaceSessionAction, { type: "generationRequestFailed" }>,
): WorkspaceSessionState {
  const {
    message,
    replyId,
    optimisticUserMessageId,
    isRequestAccepted,
    isConversationConflict,
    retryAvailableAt,
  } = action;
  return {
    ...state,
    error: message,
    messages: isRequestAccepted
      ? state.messages.map((reply) =>
          reply.id === replyId
            ? finishDetails({ ...reply, runStatus: "error", runError: message })
            : reply,
        )
      : state.messages.filter(
          (reply) =>
            reply.id !== replyId && reply.id !== optimisticUserMessageId,
        ),
    retryInput: isConversationConflict ? null : state.retryInput,
    retryAvailableAt: retryAvailableAt ?? state.retryAvailableAt,
  };
}

export function workspaceSessionReducer(
  state: WorkspaceSessionState,
  action: WorkspaceSessionAction,
): WorkspaceSessionState {
  switch (action.type) {
    case "savedConversationLoadStarted":
      return {
        ...state,
        isSubmissionInProgress: false,
        generatedCharacters: null,
        activity: "Starting generation…",
        preview: null,
        isConversationStateConfirmed: false,
        error: null,
        retryInput: null,
        retryAvailableAt: 0,
      };
    case "savedConversationRestored":
      return restoreSavedConversation(state, action);
    case "olderMessagesLoadStarted":
      return { ...state, isLoadingOlderMessages: true };
    case "olderMessagesPageReceived":
      return {
        ...state,
        messages: [
          ...action.page.messages.filter(
            (message) =>
              !state.messages.some((saved) => saved.id === message.id),
          ),
          ...state.messages.filter((message) => message.id !== "welcome"),
        ],
        olderCursor: action.page.olderCursor,
      };
    case "olderMessagesLoadingStopped":
      return { ...state, isLoadingOlderMessages: false };
    case "conversationCreationStarted":
      return { ...state, isSubmissionInProgress: true, error: null };
    case "conversationCreated":
      return {
        ...state,
        savedConversation: action.conversation,
        historyRefresh: state.historyRefresh + 1,
      };
    case "conversationCreationFinished":
      return { ...state, isSubmissionInProgress: false };
    case "optimisticUserMessageAdded":
      return {
        ...state,
        messages: [
          ...state.messages.filter((message) => message.id !== "welcome"),
          { id: action.id, role: "user", content: action.content },
        ],
      };
    case "generationRequestStarted":
      return {
        ...state,
        messages: [
          ...state.messages,
          {
            id: action.replyId,
            role: "assistant",
            content: "",
            flow: [],
            tools: [],
            steps: [],
            runStatus: "running",
          },
        ],
        retryInput: action.submission,
        retryAvailableAt: 0,
        isSubmissionInProgress: true,
        generatedCharacters: null,
        preview: null,
        activity: "Saving your message…",
        error: null,
      };
    case "generationEventReceived":
      return applyGenerationEvent(state, action);
    case "generationRequestFailed":
      return applyGenerationFailure(state, action);
    case "savedGenerationConfirmationFailed":
      return {
        ...state,
        isConversationStateConfirmed: false,
        retryInput: null,
        error:
          "Unable to confirm saved state. Reopen this conversation before continuing.",
      };
    case "generationRequestFinished":
      return {
        ...state,
        isSubmissionInProgress: false,
        generatedCharacters: null,
        preview: null,
        historyRefresh: state.historyRefresh + 1,
      };
    case "workspaceErrorReported":
      return { ...state, error: action.message };
    case "savedConversationUpdated":
      return {
        ...state,
        savedConversation:
          typeof action.update === "function"
            ? action.update(state.savedConversation)
            : action.update,
      };
    case "publicIdUpdated":
      return {
        ...state,
        publicId:
          typeof action.update === "function"
            ? action.update(state.publicId)
            : action.update,
      };
  }
}
