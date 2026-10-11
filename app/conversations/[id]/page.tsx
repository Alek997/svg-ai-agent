import { auth } from "@clerk/nextjs/server";
import { notFound } from "next/navigation";
import { WorkspaceHeader } from "@/components/workspace/workspace-header";
import { SvgWorkspace } from "@/components/workspace/svg-workspace";
import { conversationIdSchema } from "@/lib/conversations/contracts";
import { ragEnabled } from "@/lib/collections/access";
import { trackingEnabled } from "@/lib/ai/tracking";
export default async function Conversation({ params }: { params: Promise<{ id: string }> }) {
  const { userId } = await auth.protect();
  const { id } = await params;
  if (!conversationIdSchema.safeParse(id).success) notFound();
  return <main className="flex h-dvh flex-col overflow-hidden"><WorkspaceHeader /><SvgWorkspace initialConversationId={id} ragEnabled={await ragEnabled(userId)} trackingEnabled={trackingEnabled()} /></main>;
}
