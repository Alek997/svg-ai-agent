"use client";

import { useSvgBlobRef } from "@/lib/workspace/use-svg-blob-ref";

export function ReviewArtwork({
  label,
  source,
}: {
  label: string;
  source: string;
}) {
  const image = useSvgBlobRef<HTMLImageElement>(source, "src");

  return (
    <figure>
      <figcaption className="mb-2 text-sm font-medium">{label}</figcaption>
      {/* eslint-disable-next-line @next/next/no-img-element -- Server-validated SVG uses a Blob URL. */}
      <img
        ref={image}
        alt={`${label} artwork`}
        loading="lazy"
        className="h-64 w-full rounded-lg border border-stone-200 bg-stone-100 object-contain p-4"
      />
    </figure>
  );
}
