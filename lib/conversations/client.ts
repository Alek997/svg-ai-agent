import { readBoundedText } from "../http/read-bounded-text";
import { groupedDetails, finishDetails } from "./state";
import { z } from "zod";
import {
  conversationPageSchema,
  conversationListSchema,
  conversationSummarySchema,
} from "./contracts";
import { GenerationRequestError } from "../workspace/generate-client";

// Run details can contain SVG tool arguments. Bound the whole paginated response.
async function fetchConversationJson<T>(
  url: string,
  schema: z.ZodType<T>,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(url, { ...options, cache: "no-store" });
  if (!response.body) throw new Error("The server returned an empty response.");
  const text = await readBoundedText(
    response.body,
    16_000_000,
    () => new Error("Saved history exceeded its response limit."),
  );
  const json = JSON.parse(text);
  if (!response.ok)
    throw new GenerationRequestError(
      typeof json.error === "string"
        ? json.error
        : "Saved history is unavailable.",
      response.status,
    );
  return schema.parse(json);
}
export async function loadConversation(
  id: string,
  signal?: AbortSignal,
  before?: number,
) {
  const page = await fetchConversationJson(
    `/api/conversations/${id}${before ? `?before=${before}` : ""}`,
    conversationPageSchema,
    { signal },
  );
  return {
    ...page,
    messages: page.messages.map((message) => {
      const hydrated = { ...message, ...groupedDetails(message.flow) };
      return message.runStatus === "running"
        ? hydrated
        : { ...hydrated, ...finishDetails(hydrated) };
    }),
  };
}
export function listConversations(
  signal?: AbortSignal,
  cursor?: string,
  includeArtwork = false,
) {
  const params = new URLSearchParams();
  if (cursor) params.set("cursor", cursor);
  if (includeArtwork) params.set("artwork", "true");
  return fetchConversationJson(
    `/api/conversations${params.size ? `?${params}` : ""}`,
    conversationListSchema,
    { signal },
  );
}
export function createConversation(
  requestId: string,
  content: string,
  signal: AbortSignal,
  collectionId?: string | null,
) {
  return fetchConversationJson(
    "/api/conversations",
    conversationSummarySchema.extend({
      revision: z.number().int().nonnegative(),
    }),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        requestId,
        content,
        ...(collectionId ? { collectionId } : {}),
      }),
      signal,
    },
  );
}
