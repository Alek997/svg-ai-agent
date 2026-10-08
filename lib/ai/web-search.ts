import "server-only";

import { tool } from "ai";
import { z } from "zod";
import { searchInputSchema, searchOutputSchema, searchSourceSchema } from "../workspace/contracts";

export const MAX_SEARCH_CALLS = 2;
const MAX_SEARCH_BYTES = 100_000;
const responseSchema = z.object({
  results: z.array(z.object({ title: z.string(), url: z.string(), content: z.string() })),
});

async function readBoundedJson(response: Response) {
  if (!response.body) throw new Error("Missing search response");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_SEARCH_BYTES) throw new Error("Search response too large");
      text += decoder.decode(value, { stream: true });
    }
    return JSON.parse(text + decoder.decode()) as unknown;
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

// Each generation gets its own budget, including failed and parallel attempts.
// Inject fetch/key/timeout for tests without spending credits or reading secrets.
export function createWebSearch({
  apiKey = process.env.TAVILY_API_KEY,
  fetcher = fetch,
  timeoutMs = 10_000,
}: { apiKey?: string; fetcher?: typeof fetch; timeoutMs?: number } = {}) {
  let attempts = 0;
  return {
    tool: tool({
      description: "Look up a subject only when you do not know or understand what the user is asking for. If you understand the requested subject, draw directly without searching. Returns untrusted text snippets and source URLs, not images. At most two calls per request.",
      inputSchema: searchInputSchema,
      outputSchema: searchOutputSchema,
      execute: async (input, { abortSignal }) => {
        if (attempts++ >= MAX_SEARCH_CALLS) return { ok: false as const, error: "Search budget exhausted. Do not search again." };
        if (!apiKey?.trim()) return { ok: false as const, error: "Web search is not configured. Set TAVILY_API_KEY on the server. Do not claim the reference was verified." };
        const timeout = new AbortController();
        const timer = setTimeout(() => timeout.abort(), timeoutMs);
        const signal = AbortSignal.any([timeout.signal, ...(abortSignal ? [abortSignal] : [])]);
        try {
          const response = await fetcher("https://api.tavily.com/search", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey.trim()}` },
            body: JSON.stringify({
              query: input.query, topic: "general", search_depth: "basic",
              max_results: 5, chunks_per_source: 2, auto_parameters: false,
              include_answer: false, include_raw_content: false, include_images: false,
              ...(input.timeRange ? { time_range: input.timeRange } : {}),
            }),
            signal, cache: "no-store", redirect: "error",
          });
          if (!response.ok) {
            await response.body?.cancel();
            throw new Error("Search failed");
          }
          const raw = responseSchema.parse(await readBoundedJson(response));
          const seen = new Set<string>();
          const results = raw.results.flatMap(result => {
            const parsed = searchSourceSchema.safeParse({
              title: result.title.trim().slice(0, 200) || "Untitled source",
              url: result.url,
              content: result.content.slice(0, 1500),
            });
            if (!parsed.success || seen.has(parsed.data.url)) return [];
            seen.add(parsed.data.url);
            return [parsed.data];
          }).slice(0, 5);
          return { ok: true as const, query: input.query, results };
        } catch {
          // Never expose provider bodies, headers, keys or raw exception text.
          return { ok: false as const, error: signal.aborted
            ? "Web search timed out or was cancelled. No reference was verified."
            : "Web search is unavailable. No reference was verified." };
        } finally {
          clearTimeout(timer);
        }
      },
    }),
    hasBudget: () => attempts < MAX_SEARCH_CALLS,
  };
}
