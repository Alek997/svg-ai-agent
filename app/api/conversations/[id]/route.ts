import { auth } from "@clerk/nextjs/server";
import { conversationStore, ConversationError } from "@/lib/conversations/store";
import { jsonResponse, conversationErrorResponse } from "@/lib/conversations/http";
export const runtime = "nodejs";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { userId } = await auth();
  if (!userId) return jsonResponse({ error: "Please sign in to view conversations." }, 401);
  try {
    const { id } = await context.params;
    const value = new URL(request.url).searchParams.get("before");
    const before = value === null ? undefined : Number(value);
    if (before !== undefined && (!Number.isSafeInteger(before) || before < 1)) throw new ConversationError("Invalid message cursor.", 400);
    return jsonResponse(await conversationStore.page(userId, id, before));
  } catch (error) { return conversationErrorResponse(error); }
}
