import "server-only";
import { readPrivateMetadata } from "@/lib/auth/private-metadata";
import { ConversationError } from "../conversations/errors";
import { hasRagCapability } from "./capability";

export async function ragEnabled(ownerId: string) {
  return hasRagCapability(await readPrivateMetadata(ownerId));
}
export async function requireRag(ownerId: string) {
  if (!(await ragEnabled(ownerId)))
    throw new ConversationError(
      "Private collections are not enabled for this account.",
      403,
    );
}
