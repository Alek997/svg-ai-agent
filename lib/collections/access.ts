import "server-only";
import { clerkClient } from "@clerk/nextjs/server";
import { ConversationError } from "../conversations/errors";
import { hasRagCapability } from "./capability";
export async function ragEnabled(ownerId: string) {
  return hasRagCapability(
    (await (await clerkClient()).users.getUser(ownerId)).privateMetadata,
  );
}
export async function requireRag(ownerId: string) {
  if (!(await ragEnabled(ownerId)))
    throw new ConversationError(
      "Private collections are not enabled for this account.",
      403,
    );
}
