import { auth } from "@clerk/nextjs/server";
import { conversationStore } from "@/lib/conversations/store";
import { createConversationSchema } from "@/lib/conversations/contracts";
import { readJson, jsonResponse, conversationErrorResponse } from "@/lib/conversations/http";
export const runtime = "nodejs";
export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) return jsonResponse({ error: "Please sign in to save conversations." }, 401);
  try { const input = await readJson(request, createConversationSchema); return jsonResponse(await conversationStore.create(userId, input.requestId, input.content, input.collectionId), 201); }
  catch (error) { return conversationErrorResponse(error); }
}
export async function GET(request: Request) {
  const { userId } = await auth();
  if (!userId) return jsonResponse({ error: "Please sign in to view conversations." }, 401);
  try {
    const params = new URL(request.url).searchParams;
    return jsonResponse(await conversationStore.list(userId, params.get("cursor") ?? undefined, params.get("artwork") === "true"));
  }
  catch (error) { return conversationErrorResponse(error); }
}
