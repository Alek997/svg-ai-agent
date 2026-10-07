import assert from "node:assert/strict";
import { test } from "node:test";
import type { LanguageModelUsage } from "ai";
import { summarizeUsage } from "../lib/ai/usage";

const usage: LanguageModelUsage = {
  inputTokens: 1000,
  inputTokenDetails: { noCacheTokens: 750, cacheReadTokens: 250, cacheWriteTokens: 0 },
  outputTokens: 500,
  outputTokenDetails: { textTokens: 500, reasoningTokens: 0 },
  totalTokens: 1500,
};

test("reports total usage without counting cached input twice", () => {
  assert.deepEqual(summarizeUsage("any-model", usage), {
    model: "any-model", inputTokens: 1000, outputTokens: 500,
    cachedInputTokens: 250, totalTokens: 1500,
  });
});

test("missing token counts are unavailable rather than zero", () => {
  const result = summarizeUsage("any-model", {
    ...usage, inputTokens: undefined, totalTokens: undefined,
    inputTokenDetails: { noCacheTokens: undefined, cacheReadTokens: undefined, cacheWriteTokens: undefined },
  });
  assert.equal(result.inputTokens, null);
  assert.equal(result.cachedInputTokens, null);
  assert.equal(result.totalTokens, null);
});

test("falls back to input plus output when the total is missing", () => {
  assert.equal(summarizeUsage("any-model", { ...usage, totalTokens: undefined }).totalTokens, 1500);
});

test("preserves reported zero usage", () => {
  assert.equal(summarizeUsage("any-model", {
    ...usage, inputTokens: 0, outputTokens: 0, totalTokens: 0,
    inputTokenDetails: { noCacheTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
  }).totalTokens, 0);
});
