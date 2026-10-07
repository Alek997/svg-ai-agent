import { WorkspaceHeader } from "@/components/workspace/workspace-header";
import { SvgWorkspace } from "@/components/workspace/svg-workspace";
import { auth } from "@clerk/nextjs/server";

export default async function Home() {
  await auth.protect();
  return (
    <main className="flex min-h-dvh flex-col">
      <WorkspaceHeader />
      <SvgWorkspace />
    </main>
  );
}
