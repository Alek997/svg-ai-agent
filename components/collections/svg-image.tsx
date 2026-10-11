/* eslint-disable @next/next/no-img-element -- Blob URLs use the restricted SVG image renderer. */
"use client";
import { useEffect, useRef } from "react";
export function SvgImage({ source, label }: { source: string; label: string }) {
  const image = useRef<HTMLImageElement>(null);
  useEffect(() => {
    const url = URL.createObjectURL(
      new Blob([source], { type: "image/svg+xml" }),
    );
    if (image.current) image.current.src = url;
    return () => URL.revokeObjectURL(url);
  }, [source]);
  // Server-validated SVG in the browser's restricted image renderer.
  return (
    <img
      ref={image}
      alt={label}
      className="h-24 w-24 rounded-lg bg-stone-100 object-contain p-3"
    />
  );
}
