import "server-only";
import { z } from "zod";
import { ConversationError } from "./store";

export async function readJson<T>(request: Request, schema: z.ZodType<T>, maxBytes = 8000): Promise<T> {
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") throw new ConversationError("Send a JSON request.", 415);
  if (Number(request.headers.get("content-length")) > maxBytes) throw new ConversationError("Request is too large.", 413);
  const reader = request.body?.getReader();
  if (!reader) throw new ConversationError("Request body is required.", 400);
  const decoder = new TextDecoder();
  let text = "";
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) { await reader.cancel(); throw new ConversationError("Request is too large.", 413); }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    const parsed = schema.safeParse(JSON.parse(text));
    if (!parsed.success) throw new ConversationError("Invalid request. Use a message of 1–2000 characters and valid conversation identifiers.", 400);
    return parsed.data;
  } catch (error) {
    if (error instanceof ConversationError) throw error;
    throw new ConversationError("Send valid JSON.", 400);
  } finally { reader.releaseLock(); }
}
export const jsonResponse = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
export function conversationErrorResponse(error: unknown) {
  return jsonResponse({ error: error instanceof ConversationError ? error.message : "Saved conversations are unavailable. Please try again shortly." }, error instanceof ConversationError ? error.status : 503);
}
