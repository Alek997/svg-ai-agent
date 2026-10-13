"use client";

import { useState } from "react";
import { Button } from "../ui/button";

export function ShareSvg({ id }: { id: string }) {
  const [status, setStatus] = useState<"idle" | "copied" | "error">("idle");
  const path = `/s/${id}`;
  async function copy() {
    try {
      await navigator.clipboard.writeText(
        new URL(path, window.location.origin).href,
      );
      setStatus("copied");
    } catch {
      setStatus("error");
    }
  }
  return (
    <div className="relative flex h-10 items-center gap-2">
      <a
        href={path}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex h-10 items-center text-xs text-stone-600 hover:underline"
      >
        Public SVG
      </a>
      <Button className="h-10 min-w-[116px]" onClick={() => void copy()}>
        {status === "copied" ? "Link copied!" : "Copy public link"}
      </Button>
      {status === "error" && (
        <p
          role="alert"
          className="absolute top-full right-0 z-20 mt-2 w-60 rounded-lg border border-stone-200 bg-white p-3 text-xs text-stone-600 shadow-sm"
        >
          Open Public SVG and copy its address.
        </p>
      )}
    </div>
  );
}
