"use client";

import { useState } from "react";
import { Button } from "../ui/button";

export function ShareSvg({ id }: { id: string }) {
  const [status, setStatus] = useState<"idle" | "copied" | "error">("idle");
  const path = `/s/${id}`;
  async function copy() {
    try {
      await navigator.clipboard.writeText(new URL(path, window.location.origin).href);
      setStatus("copied");
    } catch { setStatus("error"); }
  }
  return <div className="flex flex-col items-end gap-1">
    <div className="flex items-center gap-2">
      <a href={path} target="_blank" rel="noopener noreferrer" className="text-xs text-stone-600 hover:underline">Public SVG</a>
      <Button onClick={() => void copy()}>{status === "copied" ? "Link copied!" : "Copy public link"}</Button>
    </div>
    <p role="status" className="max-w-60 text-right text-[10px] text-stone-500">{status === "error" ? "Open Public SVG and copy its address." : "Anyone with this link can view and download."}</p>
  </div>;
}
