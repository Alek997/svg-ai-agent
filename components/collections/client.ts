"use client";
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
