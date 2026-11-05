import "server-only";
import { clerkClient } from "@clerk/nextjs/server";
import { cache } from "react";

export const readPrivateMetadata = cache(async (userId: string) => {
  const { privateMetadata } = await (await clerkClient()).users.getUser(userId);
  return privateMetadata;
});
