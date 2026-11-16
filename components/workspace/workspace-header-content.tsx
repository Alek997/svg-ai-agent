/* eslint-disable @next/next/no-html-link-for-pages -- Full navigation preserves the workspace's beforeunload draft/run guard. */
import type { ReactNode } from "react";
import { MobileNavigation } from "./mobile-navigation";
import { Icon } from "@/components/ui/icon";

type HeaderProps = {
  showCollections: boolean;
  showEvalRuns: boolean;
  modelLabel: string;
  accountMenu: ReactNode;
};

export function WorkspaceHeaderContent({
  showCollections,
  showEvalRuns,
  modelLabel,
  accountMenu,
}: HeaderProps) {
  return (
    <header className="workspace-header flex min-h-[60px] shrink-0 items-center justify-between gap-4 border-b border-stone-200 bg-white px-3 py-2 sm:px-8 sm:py-3 lg:min-h-[76px]">
      <div className="flex shrink-0 items-center gap-2 sm:gap-3">
        <span className="hidden size-9 items-center justify-center rounded-xl bg-stone-900 text-white sm:flex">
          <Icon name="sparkles" />
        </span>
        <div>
          <h1 className="text-base font-semibold tracking-tight">
            SVG Studio
            <span className="ml-2 hidden align-middle text-[10px] font-normal uppercase tracking-widest text-stone-400 sm:inline">
              Beta
            </span>
          </h1>
          <p className="mt-0.5 hidden text-xs text-stone-500 sm:block">
            <span className="font-medium text-stone-600">{modelLabel}</span>
          </p>
        </div>
      </div>
      <nav
        aria-label="Main navigation"
        className="hidden items-center gap-4 lg:flex"
      >
        <NavigationLinks
          showCollections={showCollections}
          showEvalRuns={showEvalRuns}
        />
        <div className="shrink-0">{accountMenu}</div>
      </nav>
      <MobileNavigation>
        <NavigationLinks
          showCollections={showCollections}
          showEvalRuns={showEvalRuns}
          mobile
        />
        <div className="mt-2 flex min-h-14 items-center justify-between gap-4 border-t border-stone-100 px-3 pt-2">
          <span className="text-sm text-stone-600">Your account</span>
          {accountMenu}
        </div>
      </MobileNavigation>
    </header>
  );
}

function NavigationLinks({
  showCollections,
  showEvalRuns,
  mobile = false,
}: Pick<HeaderProps, "showCollections" | "showEvalRuns"> & {
  mobile?: boolean;
}) {
  const linkClass = mobile
    ? "flex min-h-11 items-center rounded-lg px-3 text-sm font-medium text-stone-600 hover:bg-stone-100"
    : "rounded-lg border border-stone-200 px-3 py-2 text-xs font-medium text-stone-600 hover:bg-stone-50";

  return (
    <>
      <a href="/conversations" className={linkClass}>
        My SVGs
      </a>
      {showCollections && (
        <a href="/collections" className={linkClass}>
          Collections
        </a>
      )}
      {showEvalRuns && (
        <a href="/eval-runs" className={linkClass}>
          Eval Runs
        </a>
      )}
    </>
  );
}
