"use client";

import { useEffect, useState, type ReactNode } from "react";

export function EvalNavigationLink({
  href,
  className,
  children,
  pendingLabel = "Loading…",
}: {
  href: string;
  className?: string;
  children: ReactNode;
  pendingLabel?: string;
}) {
  const [pending, setPending] = useState(false);

  useEffect(() => {
    function reset() {
      setPending(false);
    }
    window.addEventListener("pageshow", reset);
    return () => window.removeEventListener("pageshow", reset);
  }, []);

  return (
    // Use a fresh document for blind review and fresh progress after a save.
    <a
      href={href}
      className={className}
      aria-busy={pending}
      onClick={(event) => {
        if (
          event.defaultPrevented ||
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey
        )
          return;
        if (pending) event.preventDefault();
        else setPending(true);
      }}
    >
      {children}
      <span role="status">{pending ? ` · ${pendingLabel}` : ""}</span>
    </a>
  );
}
