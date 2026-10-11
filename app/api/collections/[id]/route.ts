import { auth } from "@clerk/nextjs/server";
import { z } from "zod";
import { requireRag } from "@/lib/collections/access";
import { collectionStore } from "@/lib/collections/store";
import {
  jsonResponse,
  conversationErrorResponse,
} from "@/lib/conversations/http";
import { ConversationError } from "@/lib/conversations/store";
export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };
async function owner(context: Context) {
  const { userId } = await auth();
  if (!userId) throw new ConversationError("Please sign in.", 401);
  await requireRag(userId);
  const { id } = await context.params;
  if (!z.string().uuid().safeParse(id).success)
    throw new ConversationError("Collection not found.", 404);
  return { userId, id };
}
export async function GET(_request: Request, context: Context) {
  try {
    const { userId, id } = await owner(context);
    return jsonResponse(await collectionStore.page(userId, id));
  } catch (error) {
    return conversationErrorResponse(
      error,
      "Collections are unavailable. Please try again shortly.",
    );
  }
}
export async function DELETE(_request: Request, context: Context) {
  try {
    const { userId, id } = await owner(context);
    await collectionStore.remove(userId, id);
    return jsonResponse({ deleted: true });
  } catch (error) {
    return conversationErrorResponse(
      error,
      "Collections are unavailable. Please try again shortly.",
    );
  }
}
