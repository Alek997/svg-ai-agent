"use client";

import { useEffect, useRef, type ReactNode } from "react";

/** Safari resizes the visual viewport, rather than dvh, for its keyboard. */
export function WorkspaceViewport({ children }: { children: ReactNode }) {
  const container = useRef<HTMLElement>(null);

  useEffect(() => {
    const viewport = window.visualViewport;
    const element = container.current;
    if (!viewport || !element) return;

    const resize = () => {
      // Let CSS fill the layout viewport during zoom and ordinary resizing.
      // A previous keyboard height must not survive either transition.
      if (viewport.scale !== 1 || viewport.height >= window.innerHeight - 1) {
        element.style.removeProperty("--workspace-height");
        element.style.removeProperty("--workspace-top");
        return;
      }
      element.style.setProperty("--workspace-height", `${viewport.height}px`);
      element.style.setProperty("--workspace-top", `${viewport.offsetTop}px`);
    };

    resize();
    window.addEventListener("resize", resize);
    viewport.addEventListener("resize", resize);
    viewport.addEventListener("scroll", resize);
    return () => {
      window.removeEventListener("resize", resize);
      viewport.removeEventListener("resize", resize);
      viewport.removeEventListener("scroll", resize);
    };
  }, []);

  return (
    <main
      ref={container}
      className="workspace-viewport flex min-h-0 min-w-0 flex-col overflow-hidden"
    >
      {children}
    </main>
  );
}
