import { WorkspaceViewport } from "@/components/workspace/workspace-viewport";
import { WorkspaceHeader } from "@/components/workspace/workspace-header";
import { SvgWorkspace } from "@/components/workspace/svg-workspace";
import { auth } from "@clerk/nextjs/server";
import { ragEnabled } from "@/lib/collections/access";
import { trackingEnabled } from "@/lib/ai/tracking";

export default async function Home() {
  const { userId } = await auth.protect();
  return (
    <WorkspaceViewport>
      <WorkspaceHeader />
      <SvgWorkspace
        ragEnabled={await ragEnabled(userId)}
        trackingEnabled={trackingEnabled()}
      />
    </WorkspaceViewport>
  );
}
