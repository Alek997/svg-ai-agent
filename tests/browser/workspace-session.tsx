// Exercise the session's public interface with controlled HTTP and stream timing.
import { act, useLayoutEffect, type ReactNode } from "react";
import { useWorkspaceSession } from "../../components/workspace/use-workspace-session";
import {
  WorkspaceDraft,
  useWorkspaceDraft,
} from "../../components/workspace/workspace-draft";
import type {
  ConversationPage,
  Submission,
} from "../../lib/conversations/contracts";
import type { GenerationEvent } from "../../lib/workspace/contracts";
import { sampleDocument } from "../../lib/workspace/sample";

type Harness = {
  render: (node: ReactNode) => Promise<void>;
  check: (condition: unknown, name: string) => void;
};
const conversationId = "10000000-0000-4000-8000-000000000001";
const userId = "10000000-0000-4000-8000-000000000002";
const assistantId = "10000000-0000-4000-8000-000000000003";
const started: GenerationEvent = {
  type: "started",
  conversationId,
  userMessageId: userId,
  assistantMessageId: assistantId,
  revision: 2,
  replayed: false,
};
const completedDocument = { ...sampleDocument, name: "completed.svg" };

export async function runWorkspaceSessionChecks({ render, check }: Harness) {
  let session: ReturnType<typeof useWorkspaceSession>;
  let restoredDraft = "";
  function DraftObserver() {
    const { draft } = useWorkspaceDraft();
    useLayoutEffect(() => {
      restoredDraft = draft;
    });
    return null;
  }
  function SessionFixture() {
    const value = useWorkspaceSession({
      routeId: conversationId,
      onCreated: () => {},
    });
    useLayoutEffect(() => {
      session = value;
    });
    return (
      <WorkspaceDraft ref={value.draft}>
        <DraftObserver />
      </WorkspaceDraft>
    );
  }
  let page: ConversationPage;
  let failSavedLoad = false;
  let generationStatus = 200;
  let generationCalls = 0;
  let submissions: Submission[] = [];
  let stream: ReadableStreamDefaultController<Uint8Array>;
  const fetchBefore = window.fetch;
  window.fetch = async (request, options) => {
    if (String(request).startsWith(`/api/conversations/${conversationId}`)) {
      return failSavedLoad
        ? Response.json(
            { error: "Synthetic saved-state failure" },
            { status: 503 },
          )
        : Response.json(page);
    }
    if (String(request) === "/api/generate") {
      generationCalls++;
      submissions.push(JSON.parse(String(options?.body)));
      if (generationStatus !== 200)
        return Response.json(
          { error: "Synthetic request rejection" },
          { status: generationStatus },
        );
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            stream = controller;
          },
        }),
        { headers: { "Content-Type": "application/x-ndjson" } },
      );
    }
    throw new Error(`Unexpected session request: ${request}`);
  };
  async function openSession() {
    await render(<></>);
    page = {
      conversation: {
        id: conversationId,
        title: "Saved artwork",
        updatedAt: "2026-11-15T00:00:00.000Z",
        revision: 1,
        activeRunId: null,
        leaseExpiresAt: null,
      },
      messages: [],
      document: sampleDocument,
      publicId: null,
      olderCursor: null,
    };
    failSavedLoad = false;
    generationStatus = 200;
    generationCalls = 0;
    submissions = [];
    await render(<SessionFixture />);
  }
  async function sendEvent(event: GenerationEvent) {
    await act(async () => {
      stream.enqueue(new TextEncoder().encode(JSON.stringify(event) + "\n"));
    });
  }
  function saveAssistant(
    status: "completed" | "interrupted",
    document = sampleDocument,
  ) {
    page = {
      ...page,
      conversation: { ...page.conversation, revision: 2 },
      document,
      messages: [
        {
          id: userId,
          position: 1,
          role: "user",
          content: "Edit artwork",
          excludedFromContext: false,
          flow: [],
          runStatus: "completed",
          retryable: true,
        },
        {
          id: assistantId,
          position: 2,
          role: "assistant",
          content: status === "completed" ? "Saved reply" : "",
          excludedFromContext: false,
          flow: [],
          runStatus: status,
          retryable: true,
        },
      ],
    };
  }
  try {
    await openSession();
    await act(async () => {
      await Promise.all([
        session.sendMessage("Edit artwork"),
        session.sendMessage("Duplicate"),
      ]);
    });
    check(
      generationCalls === 1,
      "Session guards concurrent submissions before a render",
    );
    await sendEvent(started);
    check(
      session!.messages.map((message) => message.id).join() ===
        [userId, assistantId].join(),
      "Started event adopts canonical message IDs",
    );
    await sendEvent({ type: "progress", characters: 0 });
    await sendEvent({
      type: "preview",
      svg: {
        source: sampleDocument.source,
        width: sampleDocument.width,
        height: sampleDocument.height,
      },
    });
    check(
      session!.isSvgGenerationInProgress &&
        session!.progress === 0 &&
        !!session!.preview &&
        session!.document?.name === sampleDocument.name,
      "Preview and zero-character progress stay separate from completed artwork",
    );
    saveAssistant("completed", completedDocument);
    await act(async () => {
      stream.close();
    });
    check(
      session!.document?.name === "completed.svg" &&
        !session!.error &&
        !session!.preview &&
        !session!.isSubmissionInProgress &&
        !session!.retryInput,
      "Canonical reload recovers a completed result lost from the stream",
    );

    await openSession();
    generationStatus = 503;
    await act(async () => {
      await session.sendMessage("Rejected edit");
    });
    check(
      restoredDraft === "Rejected edit" &&
        session!.messages.length === 0 &&
        !!session!.error &&
        !session!.retryInput &&
        session!.document?.name === sampleDocument.name,
      "Failure before acceptance restores draft and removes optimistic messages",
    );

    await openSession();
    await act(async () => {
      await session.sendMessage("Edit artwork");
    });
    await sendEvent(started);
    saveAssistant("interrupted");
    await sendEvent({
      type: "error",
      message: "Synthetic interruption",
      retryable: true,
      interrupted: true,
    });
    const retry = session!.retryInput;
    check(
      retry?.kind === "retry" &&
        retry.retryOf === assistantId &&
        session!.retryAvailableAt > Date.now() &&
        session!.document?.name === sampleDocument.name,
      "Accepted failure restores saved retry and preserves artwork with a cooldown",
    );
    await act(async () => {
      session.retry();
    });
    check(
      generationCalls === 1,
      "Session rejects retries before the cooldown expires",
    );
    const dateNow = Date.now;
    try {
      Date.now = () => session!.retryAvailableAt + 1;
      await act(async () => {
        session.retry();
      });
    } finally {
      Date.now = dateNow;
    }
    check(
      submissions[1]?.kind === "retry" &&
        submissions[1].requestId === retry?.requestId &&
        submissions[1].expectedRevision === 2,
      "Retry preserves request identity and uses the saved revision",
    );
    await sendEvent({
      type: "reply",
      reason: "conversation",
      message: "You're welcome!",
    });
    saveAssistant("completed");
    await act(async () => {
      stream.close();
    });
    check(
      !session!.retryInput && session!.document?.name === sampleDocument.name,
      "Conversational reply preserves completed artwork and clears retry",
    );

    await openSession();
    generationStatus = 409;
    await act(async () => {
      await session.sendMessage("Stale edit");
    });
    check(
      !session!.retryInput &&
        session!.isConversationStateConfirmed &&
        restoredDraft === "Stale edit",
      "Conflict refreshes saved state and restores the draft without enabling retry",
    );

    await openSession();
    await act(async () => {
      await session.sendMessage("Edit artwork");
    });
    await sendEvent(started);
    failSavedLoad = true;
    await act(async () => {
      stream.close();
    });
    const callsBeforeBlockedSend = generationCalls;
    await act(async () => {
      await session.sendMessage("Must wait");
    });
    check(
      !session!.isConversationStateConfirmed &&
        !session!.retryInput &&
        !!session!.error?.includes("Unable to confirm saved state") &&
        generationCalls === callsBeforeBlockedSend,
      "Failed reconciliation after acceptance blocks further submissions",
    );
  } finally {
    await render(<></>);
    window.fetch = fetchBefore;
  }
}
