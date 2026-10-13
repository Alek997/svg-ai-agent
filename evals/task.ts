import "server-only";
import type { LanguageModel } from "ai";
import { z } from "zod";
import { streamSvgGenerationOnServer } from "../lib/ai/generate-svg";
import { modelOutputSchema } from "../lib/ai/svg-agent";
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
) => Promise<{ output: unknown; usage: GenerationUsage }>;
const finalSchema = modelOutputSchema.extend({
  message: z.string().trim().min(1).max(2000),
  filename: z.string().regex(/^[a-z0-9][a-z0-9-]{0,59}\.svg$/),
  svg: safeSvgSchema,
});

export function createEvalTask(
  model?: LanguageModel,
  generate: Generate = (input, signal, emit) =>
    streamSvgGenerationOnServer({
      svgGenerationRequest: input,
      signal,
      onProgress: () => {},
      model,
      onEvent: emit,
    }),
) {
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
    let usage: GenerationUsage | null = null;
    try {
      const raw = await generate(
        item.input,
        AbortSignal.timeout(GENERATION_TIMEOUT_MS),
        (event) => {
          // Preview payloads repeat large SVGs; keep timing, but don't store each snapshot.
          if (event.type === "preview")
            firstPreviewMs ??= Math.round(performance.now() - start);
          else if (event.type === "step" || event.type === "tool")
            events.push(event);
        },
      );
      usage = raw.usage;
      const result = finalSchema.safeParse(raw.output);
      if (!result.success)
        return {
          status: "failed",
          source: null,
          error: "Final output failed application validation.",
          usage,
          metrics: metrics(),
          events,
        };
      return {
        status: "completed",
        source: result.data.svg.source,
        error: null,
        usage,
        metrics: metrics(),
        events,
      };
    } catch {
      // Provider exceptions can contain credentials/request data. Don't persist them.
      return {
        status: "failed",
        source: null,
        error:
          "Generation failed or timed out. Inspect the recorded steps and tools.",
        usage,
        metrics: metrics(),
        events,
      };
    }
  };
}
