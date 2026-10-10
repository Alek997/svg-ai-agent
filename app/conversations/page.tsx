import { auth } from "@clerk/nextjs/server";
import { WorkspaceHeader } from "@/components/workspace/workspace-header";
import { ConversationGallery } from "@/components/workspace/conversation-gallery";

export default async function Conversations() {
  await auth.protect();
  return <main className="flex min-h-dvh flex-col bg-stone-50"><WorkspaceHeader /><ConversationGallery /></main>;
}
