// Test-only persistence adapter. Production ownership/transactions remain in PostgreSQL.
import { randomUUID } from "node:crypto";
import {
  ConversationError,
  type StartedRun,
} from "../../../lib/conversations/store";
import { selectContext } from "../../../lib/conversations/state";
import {
  chatMessageSchema,
  conversationPageSchema,
  MESSAGE_PAGE_SIZE,
  RUN_LEASE_MS,
  type ConversationPage,
  type Submission,
} from "../../../lib/conversations/contracts";
import { safeSvgSchema } from "../../../lib/svg/validate-svg";
import type { ChatMessage, SvgDocument } from "../../../lib/workspace/types";

type SavedMessage = ConversationPage["messages"][number];
type FixtureConversation = {
  owner: string;
  page: ConversationPage;
  creationRequestId: string;
  runs: Map<string, { run: StartedRun; submission: Submission }>;
};

export class FixtureConversationStore {
  private conversations = new Map<string, FixtureConversation>();

  reset() {
    this.conversations.clear();
  }

  private owned(owner: string, id: string) {
    const saved = this.conversations.get(id);
    if (!saved || saved.owner !== owner)
      throw new ConversationError("Conversation not found.", 404);
    return saved;
  }

  create(owner: string, requestId: string, content: string) {
    const existing = [...this.conversations.values()].find(
      (item) => item.owner === owner && item.creationRequestId === requestId,
    );
    if (existing) return existing.page.conversation;
    const conversation = {
      id: randomUUID(),
      title: content.slice(0, 100),
      updatedAt: new Date().toISOString(),
      revision: 0,
      activeRunId: null,
      leaseExpiresAt: null,
    };
    this.conversations.set(conversation.id, {
      owner,
      creationRequestId: requestId,
      runs: new Map(),
      page: {
        conversation,
        messages: [],
        document: null,
        publicId: null,
        olderCursor: null,
      },
    });
    return conversation;
  }

  list(owner: string) {
    return {
      conversations: [...this.conversations.values()]
        .filter((item) => item.owner === owner)
        .reverse()
        .map(({ page }) => ({
          id: page.conversation.id,
          title: page.conversation.title,
          updatedAt: page.conversation.updatedAt,
        })),
      nextCursor: null,
    };
  }

  page(owner: string, id: string, before?: number) {
    const page = this.owned(owner, id).page;
    const messages = page.messages.filter(
      (message) => !before || message.position < before,
    );
    const selected = messages.slice(-MESSAGE_PAGE_SIZE);
    return conversationPageSchema.parse({
      ...page,
      messages: selected,
      olderCursor:
        messages.length > selected.length ? selected[0].position : null,
    });
  }

  async begin(owner: string, submission: Submission): Promise<StartedRun> {
    const saved = this.owned(owner, submission.conversationId);
    const page = saved.page;
    const duplicate = saved.runs.get(submission.requestId);
    if (duplicate) {
      const previous = duplicate.submission;
      if (
        previous.kind !== submission.kind ||
        (previous.kind === "message" && submission.kind === "message"
          ? previous.content !== submission.content
          : previous.kind === "retry" &&
            submission.kind === "retry" &&
            previous.retryOf !== submission.retryOf)
      )
        throw new ConversationError(
          "Request ID was already used for another message.",
          409,
        );
      return {
        ...duplicate.run,
        replayed: true,
        message: page.messages.find(
          (message) => message.id === duplicate.run.assistantMessageId,
        )!,
        document: page.document,
      };
    }
    if (
      page.conversation.activeRunId ||
      page.conversation.revision !== submission.expectedRevision
    )
      throw new ConversationError(
        "This conversation changed or has an active generation. Reopen it before continuing.",
        409,
      );
    let user: SavedMessage;
    if (submission.kind === "retry") {
      const previous = [...saved.runs.values()].find(
        ({ run }) => run.assistantMessageId === submission.retryOf,
      );
      const target = page.messages.at(-1);
      if (
        !previous ||
        target?.id !== submission.retryOf ||
        !target.retryable ||
        !["error", "interrupted"].includes(target.runStatus)
      )
        throw new ConversationError(
          "Only the latest failed generation can be retried.",
          409,
        );
      user = page.messages.find(
        (message) => message.id === previous.run.userMessageId,
      )!;
    } else {
      user = chatMessageSchema.parse({
        id: randomUUID(),
        position: page.messages.length + 1,
        role: "user",
        content: submission.content,
        excludedFromContext: false,
        flow: [],
        runStatus: "completed",
        retryable: true,
      });
      page.messages.push(user);
    }
    const assistant = chatMessageSchema.parse({
      id: randomUUID(),
      position: page.messages.length + 1,
      role: "assistant",
      content: "",
      excludedFromContext: false,
      flow: [],
      runStatus: "running",
      retryable: true,
    });
    page.messages.push(assistant);
    page.conversation.revision++;
    page.conversation.activeRunId = assistant.id;
    page.conversation.leaseExpiresAt = new Date(
      Date.now() + RUN_LEASE_MS,
    ).toISOString();
    const run: StartedRun = {
      replayed: false,
      conversationId: page.conversation.id,
      userMessageId: user.id,
      assistantMessageId: assistant.id,
      revision: page.conversation.revision,
      message: structuredClone(assistant),
      document: page.document,
      input: {
        conversationId: page.conversation.id,
        messages: selectContext(
          page.messages.filter((message) => message.position < user.position),
          user.content,
        ),
        ...(page.document ? { currentSvg: page.document.source } : {}),
      },
    };
    saved.runs.set(submission.requestId, { run, submission });
    return run;
  }

  async save(
    owner: string,
    run: StartedRun,
    message: ChatMessage,
    terminal: boolean,
    document?: SvgDocument,
    excludeUser = false,
  ) {
    const page = this.owned(owner, run.conversationId).page;
    if (page.conversation.activeRunId !== run.assistantMessageId)
      throw new ConversationError(
        "Generation was interrupted or superseded.",
        409,
      );
    const index = page.messages.findIndex(
      (item) => item.id === run.assistantMessageId,
    );
    page.messages[index] = chatMessageSchema.parse({
      ...page.messages[index],
      ...message,
    });
    if (document)
      page.document = { ...document, ...safeSvgSchema.parse(document.source) };
    if (excludeUser)
      page.messages.find(
        (item) => item.id === run.userMessageId,
      )!.excludedFromContext = true;
    if (terminal) {
      page.conversation.activeRunId = null;
      page.conversation.leaseExpiresAt = null;
    }
    page.conversation.updatedAt = new Date().toISOString();
  }
}
