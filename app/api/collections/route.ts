import { auth } from "@clerk/nextjs/server";
import { requireRag } from "@/lib/collections/access";
import { collectionStore } from "@/lib/collections/store";
import { collectionNameSchema } from "@/lib/collections/contracts";
import {
  readJson,
  jsonResponse,
  conversationErrorResponse,
} from "@/lib/conversations/http";

export const runtime = "nodejs";
export async function GET() {
  try {
    const { userId } = await auth();
    if (!userId) return jsonResponse({ error: "Please sign in." }, 401);
    await requireRag(userId);
    return jsonResponse({ collections: await collectionStore.list(userId) });
  } catch (error) {
    return conversationErrorResponse(
      error,
      "Collections are unavailable. Please try again shortly.",
    );
  }
}
export async function POST(request: Request) {
  try {
    const { userId } = await auth();
    if (!userId) return jsonResponse({ error: "Please sign in." }, 401);
    await requireRag(userId);
    const { name } = await readJson(request, collectionNameSchema);
    return jsonResponse(await collectionStore.create(userId, name));
  } catch (error) {
    return conversationErrorResponse(
      error,
      "Collections are unavailable. Please try again shortly.",
    );
  }
}
