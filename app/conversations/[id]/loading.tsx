import { WorkspaceSkeleton } from "@/components/workspace/workspace-loading";

export default function Loading() {
  return (
    <main className="flex h-dvh flex-col overflow-hidden">
      <div
        aria-hidden="true"
        className="h-[76px] shrink-0 border-b border-stone-200 bg-white"
      />
      <WorkspaceSkeleton />
    </main>
  );
}
