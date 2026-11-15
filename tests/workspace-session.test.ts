import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createWorkspaceSessionState,
  workspaceSessionReducer,
  type WorkspaceSessionAction,
} from "../components/workspace/workspace-session-state";
import type { ConversationPage } from "../lib/conversations/contracts";
import { sampleDocument } from "../lib/workspace/sample";

const conversationId = "10000000-0000-4000-8000-000000000001";
const message = (position: number): ConversationPage["messages"][number] => ({
  id: `10000000-0000-4000-8000-${String(position).padStart(12, "0")}`,
  position,
  role: "assistant",
  content: `Saved message ${position}`,
  excludedFromContext: false,
  flow: [],
  runStatus: "completed",
  retryable: true,
});
const page: ConversationPage = {
  conversation: {
    id: conversationId,
    title: "Saved artwork",
    updatedAt: "2026-11-15T00:00:00.000Z",
    revision: 4,
    activeRunId: null,
    leaseExpiresAt: null,
  },
  messages: [message(3), message(4)],
  document: sampleDocument,
  publicId: null,
  olderCursor: 3,
};

test("canonical reconciliation preserves paginated history, replaces saved details, and drops optimistic entries", () => {
  const previous = {
    ...createWorkspaceSessionState(null),
    messages: [
      message(1),
      { ...message(3), content: "Outdated" },
      { id: "optimistic", role: "user" as const, content: "Pending" },
    ],
    olderCursor: 1,
  };
  const snapshot = structuredClone(previous);
  const next = workspaceSessionReducer(previous, {
    type: "savedConversationRestored",
    page,
    isMergingSavedMessages: true,
    retryRequestId: "retry",
  });
  assert.deepEqual(next.messages, [message(1), ...page.messages]);
  assert.equal(next.olderCursor, 1);
  assert.deepEqual(previous, snapshot);
  const reopened = workspaceSessionReducer(next, {
    type: "savedConversationRestored",
    page,
    isMergingSavedMessages: false,
    retryRequestId: "retry",
  });
  assert.deepEqual(reopened.messages, page.messages);
  assert.equal(reopened.olderCursor, 3);
});

test("older pages prepend only unseen messages without replacing newer details", () => {
  const initial = {
    ...createWorkspaceSessionState(conversationId),
    messages: [message(3)],
  };
  const next = workspaceSessionReducer(initial, {
    type: "olderMessagesPageReceived",
    page: {
      ...page,
      messages: [message(1), { ...message(3), content: "Stale duplicate" }],
      olderCursor: null,
    },
  });
  assert.deepEqual(next.messages, [message(1), message(3)]);
  assert.equal(next.olderCursor, null);
});

test("restoring a retryable saved attempt uses supplied identity and preserves cooldown", () => {
  const initial = {
    ...createWorkspaceSessionState(conversationId),
    retryAvailableAt: 12345,
  };
  const action: WorkspaceSessionAction = {
    type: "savedConversationRestored",
    isMergingSavedMessages: true,
    retryRequestId: "stable-request-id",
    page: {
      ...page,
      messages: [
        { ...message(4), runStatus: "interrupted", runError: "Interrupted" },
      ],
    },
  };
  const next = workspaceSessionReducer(initial, action);
  assert.deepEqual(next.retryInput, {
    kind: "retry",
    conversationId,
    retryOf: message(4).id,
    requestId: "stable-request-id",
    expectedRevision: 4,
  });
  assert.equal(next.retryAvailableAt, 12345);
  assert.deepEqual(workspaceSessionReducer(initial, action), next);
  const unaccepted = workspaceSessionReducer(initial, {
    ...action,
    unacceptedFailure: {
      message: "Request rejected",
      submissionKind: "message",
    },
  });
  assert.equal(unaccepted.retryInput, null);
  assert.equal(unaccepted.error, "Request rejected");
});

test("public setter adapters preserve sequential functional updates and privacy metadata", () => {
  let state = workspaceSessionReducer(
    createWorkspaceSessionState(conversationId),
    {
      type: "savedConversationUpdated",
      update: page.conversation,
    },
  );
  state = workspaceSessionReducer(state, {
    type: "savedConversationUpdated",
    update: (previous) =>
      previous ? { ...previous, private: true } : previous,
  });
  assert.equal(state.savedConversation?.private, true);
  assert.equal(state.savedConversation?.revision, 4);
  state = workspaceSessionReducer(state, {
    type: "publicIdUpdated",
    update: "public-id",
  });
  state = workspaceSessionReducer(state, {
    type: "publicIdUpdated",
    update: (previous) => `${previous}-updated`,
  });
  assert.equal(state.publicId, "public-id-updated");
});

test("result transitions use event receipt time for feedback expiry and preserve the previous state", () => {
  const previous = {
    ...createWorkspaceSessionState(conversationId),
    messages: [message(4)],
    preview: { ...sampleDocument, name: "draft.svg" },
    publicId: "previous-result",
  };
  const snapshot = structuredClone(previous);
  const action: WorkspaceSessionAction = {
    type: "generationEventReceived",
    replyId: message(4).id,
    receivedAt: 1000,
    event: {
      type: "result",
      message: "Updated artwork",
      document: sampleDocument,
      feedbackToken: "feedback",
      usage: {
        model: "mock",
        inputTokens: 1,
        outputTokens: 1,
        cachedInputTokens: 0,
        totalTokens: 2,
      },
    },
  };
  const next = workspaceSessionReducer(previous, action);
  assert.equal(
    next.messages[0].feedbackExpiresAt,
    1000 + 7 * 24 * 60 * 60 * 1000,
  );
  assert.equal(next.messages[0].runStatus, "completed");
  assert.equal(next.preview, null);
  assert.equal(next.publicId, null);
  assert.deepEqual(previous, snapshot);
  assert.deepEqual(workspaceSessionReducer(previous, action), next);
});
