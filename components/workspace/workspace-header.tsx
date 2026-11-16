import { auth } from "@clerk/nextjs/server";
import { ragEnabled } from "@/lib/collections/access";
import { canReviewEvals } from "@/lib/eval-review/access";
import { WorkspaceHeaderContent } from "./workspace-header-content";
import { UserButton } from "@clerk/nextjs";
import { getConfiguredModelLabel } from "@/lib/ai/config";

export async function WorkspaceHeader() {
  const { userId } = await auth();
  const [showCollections, showEvalRuns] = userId
    ? await Promise.all([ragEnabled(userId), canReviewEvals(userId)])
    : [false, false];
  return (
    <WorkspaceHeaderContent
      showCollections={showCollections}
      showEvalRuns={showEvalRuns}
      modelLabel={getConfiguredModelLabel()}
      accountMenu={<UserButton />}
    />
  );
}
