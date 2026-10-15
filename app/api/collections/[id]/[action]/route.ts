import { auth } from "@clerk/nextjs/server";
import { z } from "zod";
import { requireRag } from "@/lib/collections/access";
import { collectionStore } from "@/lib/collections/store";
import { processCollection } from "@/lib/collections/process";
import { retrieveOwnedCollectionReferencesOnServer } from "@/lib/collections/retrieval";
import {
  readJson,
  jsonResponse,
  conversationErrorResponse,
} from "@/lib/conversations/http";
import { ConversationError } from "@/lib/conversations/store";

export const runtime = "nodejs";
export const maxDuration = 240;
const uuid = z.string().uuid();
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string; action: string }> },
) {
  try {
    const { userId } = await auth();
    if (!userId) throw new ConversationError("Please sign in.", 401);
    await requireRag(userId);
    const { id, action } = await context.params;
    if (!uuid.safeParse(id).success)
      throw new ConversationError("Collection not found.", 404);
    await collectionStore.page(userId, id);
    if (action === "upload") {
      const { files } = await readJson(
        request,
        z.object({ files: z.array(z.unknown()).min(1).max(5) }).strict(),
        700_000,
      );
      return jsonResponse(await collectionStore.upload(userId, id, files));
    }
    if (action === "process")
      return jsonResponse(await processCollection(userId, id, request.signal));
    if (action === "retry") {
      const { iconId, reindex } = await readJson(
        request,
        z.object({ iconId: uuid, reindex: z.boolean().optional() }).strict(),
      );
      await collectionStore.retry(userId, id, iconId, reindex);
      return jsonResponse({ retried: true });
    }
    if (action === "search") {
      const { query } = await readJson(
        request,
        z.object({ query: z.string().trim().min(1).max(4001) }).strict(),
        20_000,
      );
      return jsonResponse(
        await retrieveOwnedCollectionReferencesOnServer({
          authenticatedUserId: userId,
          collectionId: id,
          query,
          signal: request.signal,
        }),
      );
    }
    if (action === "add-result") {
      const { conversationId } = await readJson(
        request,
        z.object({ conversationId: uuid }).strict(),
      );
      return jsonResponse(
        await collectionStore.addResult(userId, id, conversationId),
      );
    }
    if (action === "delete-icon") {
      const { iconId } = await readJson(
        request,
        z.object({ iconId: uuid }).strict(),
      );
      await collectionStore.remove(userId, id, iconId);
      return jsonResponse({ deleted: true });
    }
    throw new ConversationError("Unknown collection action.", 404);
  } catch (error) {
    return conversationErrorResponse(
      error,
      "Collections are unavailable. Please try again shortly.",
    );
  }
}
