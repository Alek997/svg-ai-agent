/* eslint-disable @next/next/no-img-element -- Blob URLs use the restricted SVG image renderer. */
"use client";
import { useSvgBlobRef } from "@/lib/workspace/use-svg-blob-ref";
export function SvgImage({ source, label }: { source: string; label: string }) {
  const image = useSvgBlobRef<HTMLImageElement>(source, "src");
  // Server-validated SVG in the browser's restricted image renderer.
  return (
    <img
      ref={image}
      alt={label}
      className="h-24 w-24 rounded-lg bg-stone-100 object-contain p-3"
    />
  );
}
