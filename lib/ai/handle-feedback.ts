import "server-only";
import { feedbackRequestSchema, type FeedbackRequest } from "../workspace/feedback";
import { verifyFeedbackToken } from "./feedback-token";

const maxBytes = 8000;
type SaveFeedback = (id: string, feedback: FeedbackRequest, userId: string) => Promise<void>;

export async function handleFeedback(request: Request, userId: string | null, secret: string | undefined, save: SaveFeedback) {
  const respond = (error: string, status: number) => Response.json({ error }, { status, headers: { "Cache-Control": "no-store" } });
  if (!userId) return respond("Please sign in to send feedback.", 401);
  if (!secret || secret.length < 32) return respond("Feedback is currently unavailable.", 503);
  if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") return respond("Send a JSON request.", 415);
  if (Number(request.headers.get("content-length")) > maxBytes) return respond("Feedback is too large.", 413);
  const reader = request.body?.getReader();
  if (!reader) return respond("Feedback is required.", 400);
  let text = "";
  let bytes = 0;
  const decoder = new TextDecoder();
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel();
        return respond("Feedback is too large.", 413);
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    let body: unknown;
    try { body = JSON.parse(text); }
    catch { return respond("Send valid JSON.", 400); }
    const parsed = feedbackRequestSchema.safeParse(body);
    if (!parsed.success) return respond("Choose a rating and use a comment of at most 1000 characters.", 400);
    const id = verifyFeedbackToken(parsed.data.token, userId, secret);
    if (!id) return respond("This feedback link is invalid or expired. Generate a new result to rate it.", 403);
    await save(id, parsed.data, userId);
    return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return respond("Feedback could not be saved. Please try again.", 503);
  } finally { reader.releaseLock(); }
}
