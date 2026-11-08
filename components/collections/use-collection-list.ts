"use client";

import { useEffect, useState } from "react";
import type { CollectionSummary } from "@/lib/collections/contracts";
import { listCollections } from "./client";

export function useCollectionList() {
  const [collections, setCollections] = useState<CollectionSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void listCollections(controller.signal)
      .then((value) => setCollections(value.collections))
      .catch((error) => {
        if (!controller.signal.aborted) setError(error.message);
      });
    return () => controller.abort();
  }, []);
  return { collections, setCollections, error, setError };
}
