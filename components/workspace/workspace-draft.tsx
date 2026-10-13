"use client";

import {
  createContext,
  useContext,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ReactNode,
  type Ref,
} from "react";
import { Button } from "@/components/ui/button";

const DraftContext = createContext<{
  draft: string;
  setDraft: (value: string) => void;
} | null>(null);

export function useWorkspaceDraft() {
  const value = useContext(DraftContext);
  if (!value) throw new Error("Workspace draft boundary is missing.");
  return value;
}

export type DraftHandle = { restore: (value: string) => void };
export function WorkspaceDraft({
  children,
  ref,
}: {
  children: ReactNode;
  ref: Ref<DraftHandle>;
}) {
  const [draft, setDraft] = useState("");
  useImperativeHandle(ref, () => ({ restore: setDraft }), []);
  return <DraftContext value={{ draft, setDraft }}>{children}</DraftContext>;
}

export type NavigationHandle = { navigate: (path: string) => void };
export function WorkspaceNavigation({
  ref,
  isLoading,
  pathname,
  onNewSession,
  onRefresh,
  onAbort,
}: {
  ref: Ref<NavigationHandle>;
  isLoading: boolean;
  pathname: string;
  onNewSession: () => void;
  onRefresh: () => void;
  onAbort: () => void;
}) {
  const { draft } = useWorkspaceDraft();
  const hasUnsavedWork = !!draft.trim() || isLoading;
  const dialog = useRef<HTMLDialogElement>(null);
  const keepWorking = useRef<HTMLButtonElement>(null);
  const pendingPath = useRef("/");
  useEffect(() => {
    if (!hasUnsavedWork) return;
    function warn(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = true;
    }
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [hasUnsavedWork]);
  useImperativeHandle(ref, () => ({
    navigate(path) {
      if (hasUnsavedWork) {
        pendingPath.current = path;
        dialog.current?.showModal();
        keepWorking.current?.focus();
      } else if (path === "/" && pathname === "/") onNewSession();
      else window.history.pushState(null, "", path);
    },
  }));
  function confirm() {
    dialog.current?.close();
    onAbort();
    window.history.pushState(null, "", pendingPath.current);
    if (pendingPath.current === pathname) {
      if (pathname === "/") onNewSession();
      else onRefresh();
    }
  }
  return (
    <dialog
      ref={dialog}
      aria-labelledby="reset-title"
      className="fixed inset-0 m-auto w-[calc(100%-2rem)] max-w-md rounded-2xl border border-stone-200 bg-white p-6 text-stone-800 shadow-xl backdrop:bg-stone-900/40"
    >
      <h2 id="reset-title" className="text-lg font-semibold">
        Leave this workspace?
      </h2>
      <p className="mt-3 text-sm leading-6 text-stone-600">
        Saved conversations and artwork will remain in your history. Your unsent
        draft will be discarded, and any active generation will be interrupted.
      </p>
      <div className="mt-6 flex justify-end gap-3">
        <button
          ref={keepWorking}
          type="button"
          onClick={() => dialog.current?.close()}
          className="rounded-lg border border-stone-200 px-3 py-2 text-xs"
        >
          Keep working
        </button>
        <Button onClick={confirm}>Leave workspace</Button>
      </div>
    </dialog>
  );
}
