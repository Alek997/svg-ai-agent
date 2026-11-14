import "server-only";
import type { LanguageModel } from "ai";
import { z } from "zod";
import { streamSvgGenerationOnServer } from "../lib/ai/generate-svg";
import { modelOutputSchema } from "../lib/ai/svg-agent";
import {
  checkGenerationPolicy,
  InputPolicyError,
  type PolicyOutcome,
} from "../lib/ai/input-policy";
import { createWebSearch } from "../lib/ai/web-search";
import type { Retrieval } from "../lib/collections/contracts";
import { safeSvgSchema } from "../lib/svg/validate-svg";
import { GENERATION_TIMEOUT_MS } from "../lib/workspace/generation-limits";
import type {
  GenerationEvent,
  GenerationRequest,
  GenerationUsage,
} from "../lib/workspace/contracts";
import type { EvalCase, EvalOutput } from "./types";

type Generate = (
  input: GenerationRequest,
  signal: AbortSignal,
  emit: (event: GenerationEvent) => void,
  item: EvalCase,
  retrieval?: Retrieval,
) => Promise<{ output: unknown; usage: GenerationUsage }>;
type Policy = (
  input: GenerationRequest,
  signal: AbortSignal,
) => Promise<PolicyOutcome>;
const finalSchema = modelOutputSchema.extend({
  message: z.string().trim().min(1).max(2000),
  filename: z.string().regex(/^[a-z0-9][a-z0-9-]{0,59}\.svg$/),
  svg: safeSvgSchema,
});

export function createEvalTask(
  model?: LanguageModel,
  generate?: Generate,
  options: { policy?: Policy } = {},
) {
  const runGeneration: Generate =
    generate ??
    ((input, signal, emit, item, retrieval) => {
      const fixtureResults = item.expected.fixture?.searchResults;
      const webSearch =
        fixtureResults || item.category === "injection_tool"
          ? createWebSearch({
              apiKey: "controlled-eval-fixture",
              fetcher: async () =>
                new Response(
                  JSON.stringify({ results: fixtureResults ?? [] }),
                  {
                    status: 200,
                  },
                ),
            })
          : undefined;
      return streamSvgGenerationOnServer({
        svgGenerationRequest: input,
        signal,
        onProgress: () => {},
        model,
        onEvent: emit,
        webSearch,
        collectionRetrievalContext: retrieval,
      });
    });
  const policy = options.policy ?? checkGenerationPolicy;

  return async (item: EvalCase): Promise<EvalOutput> => {
    const start = performance.now();
    const events: GenerationEvent[] = [];
    let firstPreviewMs: number | null = null;
    const metrics = () => ({
      durationMs: Math.round(performance.now() - start),
      firstPreviewMs,
      steps: Math.max(
        0,
        ...events.flatMap((event) =>
          event.type === "step" ? [event.detail.step] : [],
        ),
      ),
      validationAttempts: new Set(
        events.flatMap((event) =>
          event.type === "tool" &&
          event.call.name === "validateSvg" &&
          event.call.status === "running"
            ? [event.call.id]
            : [],
        ),
      ).size,
    });
    const result = (
      status: EvalOutput["status"],
      policyStatus: EvalOutput["policy"],
      source: string | null,
      error: string | null,
      usage: GenerationUsage | null,
    ): EvalOutput => ({
      status,
      policy: policyStatus,
      source,
      message: null,
      error,
      usage,
      metrics: metrics(),
      events,
    });
    let usage: GenerationUsage | null = null;
    let observedPolicy: EvalOutput["policy"] =
      item.mode === "policy" ? "unavailable" : "not_applicable";
    const signal = AbortSignal.timeout(GENERATION_TIMEOUT_MS);
    try {
      if (item.mode === "policy") {
        let decision: PolicyOutcome;
        try {
          decision = await policy(item.input, signal);
        } catch (error) {
          if (error instanceof InputPolicyError && error.status === 422)
            return result("rejected", "rejected", null, null, null);
          return result(
            "failed",
            "unavailable",
            null,
            "Policy check failed.",
            null,
          );
        }
        if (decision.kind === "reply") {
          const policyStatus =
            decision.reason === "clarification" ? "clarified" : "conversation";
          return result(policyStatus, policyStatus, null, null, null);
        }
        observedPolicy = "passed";
      }
      const fixtureText = item.expected.fixture?.retrievalText;
      const retrieval: Retrieval | undefined = fixtureText
        ? {
            query:
              item.input.messages.at(-1)?.content ?? "controlled eval fixture",
            collectionId: "00000000-0000-4000-8000-000000000001",
            collectionName: "Controlled eval fixture",
            candidates: [],
            references: [],
            conventions: [fixtureText],
          }
        : undefined;
      const raw = await runGeneration(
        item.input,
        signal,
        (event) => {
          if (event.type === "preview")
            firstPreviewMs ??= Math.round(performance.now() - start);
          else if (event.type === "step" || event.type === "tool")
            events.push(event);
        },
        item,
        retrieval,
      );
      usage = raw.usage;
      const parsed = finalSchema.safeParse(raw.output);
      if (!parsed.success)
        return result(
          "failed",
          observedPolicy,
          null,
          "Final output failed application validation.",
          usage,
        );
      return {
        ...result(
          "completed",
          observedPolicy,
          parsed.data.svg.source,
          null,
          usage,
        ),
        message: parsed.data.message,
      };
    } catch {
      return result(
        "failed",
        observedPolicy,
        null,
        "Generation failed or timed out. Inspect the recorded steps and tools.",
        usage,
      );
    }
  };
}
