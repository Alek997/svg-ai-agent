"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";

export function MobileNavigation({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  function close() {
    setOpen(false);
    toggle.current?.focus();
  }

  useEffect(() => {
    if (!open) return;
    function outside(event: PointerEvent) {
      if (
        event.target instanceof Node &&
        !container.current?.contains(event.target)
      ) {
        setOpen(false);
      }
    }
    function escape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        toggle.current?.focus();
      }
    }
    const desktop = window.matchMedia("(min-width: 64rem)");
    function resize() {
      if (desktop.matches) setOpen(false);
    }
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    desktop.addEventListener("change", resize);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
      desktop.removeEventListener("change", resize);
    };
  }, [open]);

  return (
    <div ref={container} className="relative lg:hidden">
      <button
        ref={toggle}
        type="button"
        aria-label="Open navigation menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((value) => !value)}
        className="inline-flex size-11 items-center justify-center rounded-lg text-stone-600 hover:bg-stone-100"
      >
        <Icon name="menu" width={22} height={22} />
      </button>
      <nav
        id={menuId}
        hidden={!open}
        aria-label="Mobile navigation"
        onClick={(event) => {
          if (
            event.target instanceof Element &&
            event.target.closest("a[href]")
          ) {
            setOpen(false);
          }
        }}
        className="absolute top-[calc(100%+0.75rem)] right-0 z-50 max-h-[calc(100dvh-5.5rem)] w-[min(20rem,calc(100vw-1.5rem))] overflow-y-auto rounded-2xl border border-stone-200 bg-white p-3 text-stone-800 shadow-xl"
      >
        <div className="mb-2 flex items-center justify-between border-b border-stone-100 pb-2 pl-3">
          <h2 className="text-sm font-semibold">Menu</h2>
          <Button
            variant="ghost"
            onClick={close}
            aria-label="Close navigation menu"
            className="size-11 p-0"
          >
            <Icon name="close" width={20} height={20} />
          </Button>
        </div>
        {/* Keep account controls mounted so their portaled dialogs survive dismissal. */}
        {children}
      </nav>
    </div>
  );
}
