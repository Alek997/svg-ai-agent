import { auth } from "@clerk/nextjs/server";
import { notFound } from "next/navigation";
import { ragEnabled } from "@/lib/collections/access";
import { WorkspaceHeader } from "@/components/workspace/workspace-header";
import { CollectionManager } from "@/components/collections/collection-manager";
export default async function CollectionsPage() {
  const { userId } = await auth.protect();
  if (!(await ragEnabled(userId))) notFound();
  return (
    <main className="min-h-dvh bg-stone-50">
      <WorkspaceHeader />
      <CollectionManager />
    </main>
  );
}
