import { Icon } from "@/components/ui/icon";
import { UserButton } from "@clerk/nextjs";
import { getConfiguredModelName } from "@/lib/ai/model";

export function WorkspaceHeader() {
  return (
    <header className="flex h-[76px] shrink-0 items-center justify-between border-b border-stone-200 bg-white px-5 sm:px-8">
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
            Model: <span className="font-medium text-stone-600">{getConfiguredModelName()}</span>
          </p>
        </div>
      </div>
      <div className="flex items-center gap-4">
        <span className="hidden rounded-full border border-stone-200 px-3 py-1.5 text-xs text-stone-500 sm:block">
          Your creative workspace
        </span>
        <UserButton />
      </div>
    </header>
  );
}
