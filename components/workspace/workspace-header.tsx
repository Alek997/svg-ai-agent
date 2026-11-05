import { auth } from "@clerk/nextjs/server";
import { ragEnabled } from "@/lib/collections/access";
import { canReviewEvals } from "@/lib/eval-review/access";
import { Icon } from "@/components/ui/icon";
import { UserButton } from "@clerk/nextjs";
import { getConfiguredModelName } from "@/lib/ai/model";

export async function WorkspaceHeader() {
  const { userId } = await auth();
  const [showCollections, showEvalRuns] = userId
    ? await Promise.all([ragEnabled(userId), canReviewEvals(userId)])
    : [false, false];
  return (
    <header className="flex min-h-[76px] shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-stone-200 bg-white px-5 py-3 sm:px-8">
      <div className="flex items-center gap-3">
        <span className="flex size-9 items-center justify-center rounded-xl bg-stone-900 text-white">
          <Icon name="sparkles" />
        </span>
        <div>
          <h1 className="text-base font-semibold tracking-tight">
            SVG Studio
            <span className="ml-2 align-middle text-[10px] font-normal uppercase tracking-widest text-stone-400">
              Beta
            </span>
          </h1>
          <p className="mt-0.5 text-xs text-stone-500">
            Model:{" "}
            <span className="font-medium text-stone-600">
              {getConfiguredModelName()}
            </span>
          </p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 sm:gap-4">
        {/* Full navigation triggers the workspace's beforeunload draft/run guard. */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
        <a
          href="/conversations"
          className="rounded-lg border border-stone-200 px-3 py-2 text-xs font-medium text-stone-600 hover:bg-stone-50"
        >
          My SVGs
        </a>
        {showCollections && (
          <a
            href="/collections"
            className="rounded-lg border border-stone-200 px-3 py-2 text-xs font-medium text-stone-600 hover:bg-stone-50"
          >
            Collections
          </a>
        )}
        {showEvalRuns && (
          <a
            href="/eval-runs"
            className="rounded-lg border border-stone-200 px-3 py-2 text-xs font-medium text-stone-600 hover:bg-stone-50"
          >
            Eval Runs
          </a>
        )}
        <UserButton />
      </div>
    </header>
  );
}
