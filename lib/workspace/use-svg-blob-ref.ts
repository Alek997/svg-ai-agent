"use client";

import { useCallback } from "react";

// Only pass server-validated SVG or parser-validated progressive snapshots.
// React attaches the URL on mount/source changes and revokes it on detach.
export function useSvgBlobRef<T extends HTMLImageElement | HTMLAnchorElement>(
  source: string,
  attribute: "src" | "href",
) {
  return useCallback(
    (node: T | null) => {
      if (!node) return;
      const url = URL.createObjectURL(
        new Blob([source], { type: "image/svg+xml" }),
      );
      node.setAttribute(attribute, url);
      return () => {
        node.removeAttribute(attribute);
        URL.revokeObjectURL(url);
      };
    },
    [source, attribute],
  );
}
