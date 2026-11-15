import "server-only";
import { createOpenAI } from "@ai-sdk/openai";
import { wrapLanguageModel } from "ai";
import { getOpenAIKey } from "../../../lib/ai/model";
import { streamSvgGenerationOnServer } from "../../../lib/ai/generate-svg";
import { createWebSearch } from "../../../lib/ai/web-search";
import type { ServerSvgGenerator } from "../../../lib/ai/handle-generation";
import {
  liveSmokeLimits,
  liveSmokePrompt,
  requireLiveSmokeApproval,
} from "./settings";

// Enforce cost limits at the actual outbound fetch, not just at model-loop steps.
export function createPaidRequestGuard(
  modelId: string,
  fetcher: typeof fetch = fetch,
) {
  let providerRequests = 0;
  let largestInputBytes = 0;
  let stopped = false;
  const deadline = AbortSignal.timeout(liveSmokeLimits.timeoutMs);
  const guardedFetch: typeof fetch = async (url, options) => {
    if (stopped || deadline.aborted)
      throw new Error("Live smoke request budget is stopped.");
    const bodyText = typeof options?.body === "string" ? options.body : "";
    const body = JSON.parse(bodyText);
    const inputBytes = Buffer.byteLength(bodyText, "utf8");
    if (
      String(url) !== "https://api.openai.com/v1/responses" ||
      body.model !== modelId ||
      body.store !== false ||
      !Number.isInteger(body.max_output_tokens) ||
      body.max_output_tokens < 1 ||
      body.max_output_tokens > liveSmokeLimits.outputTokensPerRequest ||
      inputBytes > liveSmokeLimits.serializedInputBytesPerRequest ||
      providerRequests >= liveSmokeLimits.providerRequests
    ) {
      stopped = true;
      throw new Error(
        "Live smoke refused a request outside its approved endpoint, model or budget.",
      );
    }
    providerRequests++;
    largestInputBytes = Math.max(largestInputBytes, inputBytes);
    try {
      const response = await fetcher(url, {
        ...options,
        redirect: "error",
        signal: options?.signal
          ? AbortSignal.any([options.signal, deadline])
          : deadline,
      });
      if (!response.ok) stopped = true;
      return response;
    } catch {
      stopped = true;
      // Generic errors are non-retryable in the SDK; never expose credentials/provider bodies.
      throw new Error(
        "Live smoke provider request failed; outbound retries are disabled.",
      );
    }
  };
  return {
    fetch: guardedFetch,
    stop: () => {
      stopped = true;
    },
    stats: () => ({ providerRequests, largestInputBytes }),
  };
}

export function createBoundedLiveGenerator() {
  const settings = requireLiveSmokeApproval();
  const guard = createPaidRequestGuard(settings.model);
  const provider = createOpenAI({ apiKey: getOpenAIKey(), fetch: guard.fetch });
  const model = wrapLanguageModel({
    model: provider.responses(settings.model),
    middleware: {
      transformParams: async ({ params }) => ({
        ...params,
        maxOutputTokens: liveSmokeLimits.outputTokensPerRequest,
      }),
      wrapGenerate: async () => {
        throw new Error("Live smoke supports streaming only.");
      },
      wrapStream: async ({ doStream }) => {
        try {
          const result = await doStream();
          return {
            ...result,
            stream: result.stream.pipeThrough(
              new TransformStream({
                transform(chunk, controller) {
                  if (chunk.type === "error") {
                    guard.stop();
                    controller.enqueue({
                      ...chunk,
                      error: new Error(
                        "Live smoke provider stream failed; outbound retries are disabled.",
                      ),
                    });
                  } else controller.enqueue(chunk);
                },
              }),
            ),
          };
        } catch {
          guard.stop();
          throw new Error(
            "Live smoke provider call failed; outbound retries are disabled.",
          );
        }
      },
    },
  });
  let submissionConsumed = false;
  const generate: ServerSvgGenerator = async (
    input,
    signal,
    onProgress,
    onEvent,
  ) => {
    if (
      submissionConsumed ||
      input.currentSvg ||
      input.messages.length !== 1 ||
      input.messages[0].content !== liveSmokePrompt
    )
      throw new Error("Live smoke permits one fixed creation prompt only.");
    submissionConsumed = true;
    return streamSvgGenerationOnServer({
      svgGenerationRequest: input,
      signal: AbortSignal.any([
        signal,
        AbortSignal.timeout(liveSmokeLimits.timeoutMs),
      ]),
      onProgress,
      onEvent,
      model,
      webSearch: { ...createWebSearch({ apiKey: "" }), hasBudget: () => false },
    });
  };
  return { generate, stats: guard.stats };
}
