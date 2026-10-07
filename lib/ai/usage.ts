import "server-only";

import type { LanguageModelUsage } from "ai";
import type { GenerationUsage } from "../workspace/contracts";

export function summarizeUsage(model: string, usage: LanguageModelUsage): GenerationUsage {
  const inputTokens = usage.inputTokens ?? null;
  const outputTokens = usage.outputTokens ?? null;
  const cachedInputTokens = usage.inputTokenDetails.cacheReadTokens ?? null;
  // Missing provider usage is unavailable, not zero. Cached input is already
  // included in inputTokens and must not be added to the total again.
  const totalTokens = usage.totalTokens ??
    (inputTokens !== null && outputTokens !== null ? inputTokens + outputTokens : null);
  return { model, inputTokens, outputTokens, cachedInputTokens, totalTokens };
}
