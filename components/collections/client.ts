"use client";

import type { CollectionSummary } from "@/lib/collections/contracts";

export async function collectionRequest<T>(
  path = "",
  body?: unknown,
  signal?: AbortSignal,
  method?: string,
): Promise<T> {
  const response = await fetch(`/api/collections${path}`, {
    method: method ?? (body === undefined ? "GET" : "POST"),
    ...(body === undefined
      ? {}
      : {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
    cache: "no-store",
    signal,
  });
  const value = await response.json();
  if (!response.ok)
    throw new Error(value.error || "Collection request failed. Please retry.");
  return value;
}

export function listCollections(signal?: AbortSignal) {
  return collectionRequest<{ collections: CollectionSummary[] }>(
    "",
    undefined,
    signal,
  );
}
