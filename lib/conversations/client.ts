import { groupedDetails, finishDetails } from "./state";
import { z } from "zod";
import { conversationPageSchema, conversationListSchema, conversationSummarySchema } from "./contracts";
import { GenerationRequestError } from "../workspace/generate-client";

// Run details can contain SVG tool arguments. Bound the whole paginated response.
export async function fetchConversationJson<T>(url: string, schema: z.ZodType<T>, options: RequestInit = {}): Promise<T> {
  const response = await fetch(url, { ...options, cache: "no-store" });
  const reader = response.body?.getReader();
  if (!reader) throw new Error("The server returned an empty response.");
  const decoder = new TextDecoder();
  let text = "";
  let bytes = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 16_000_000) { await reader.cancel(); throw new Error("Saved history exceeded its response limit."); }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    const json = JSON.parse(text);
    if (!response.ok) throw new GenerationRequestError(typeof json.error === "string" ? json.error : "Saved history is unavailable.", response.status);
    return schema.parse(json);
  } finally { reader.releaseLock(); }
}
export async function loadConversation(id: string, signal?: AbortSignal, before?: number) {
  const page = await fetchConversationJson(`/api/conversations/${id}${before ? `?before=${before}` : ""}`, conversationPageSchema, { signal });
  return { ...page, messages: page.messages.map(message => {
    const hydrated = { ...message, ...groupedDetails(message.flow) };
    return message.runStatus === "running" ? hydrated : { ...hydrated, ...finishDetails(hydrated) };
  }) };
}
export function listConversations(signal?: AbortSignal, cursor?: string) {
  return fetchConversationJson(`/api/conversations${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`, conversationListSchema, { signal });
}
export function createConversation(requestId: string, content: string, signal: AbortSignal) {
  return fetchConversationJson("/api/conversations", conversationSummarySchema.extend({ revision: z.number().int().nonnegative() }), {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ requestId, content }), signal,
  });
}
