import { WorkspaceHeader } from "@/components/workspace/workspace-header";
import { SvgWorkspace } from "@/components/workspace/svg-workspace";

export default function Home() {
  return (
    <main className="flex min-h-dvh flex-col">
      <WorkspaceHeader />
      <SvgWorkspace />
    </main>
  );
}
