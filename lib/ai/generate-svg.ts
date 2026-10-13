import "server-only";
import { MAX_STREAM_OUTPUT_CHARACTERS } from "../workspace/generation-limits";
import type { Retrieval } from "../collections/contracts";

import type { LanguageModel } from "ai";
import { buildSvgAgentMessages, createSvgAgent } from "./svg-agent";
import { getLLM } from "./model";
import { createWebSearch } from "./web-search";
import { summarizeUsage } from "./usage";
import type { ServerSvgGenerator } from "./handle-generation";
import { toolTraceSchema } from "../workspace/contracts";
import type {
  GenerationRequest,
  GenerationEvent,
} from "../workspace/contracts";
import { createSvgPreview, readStreamedSvg } from "../svg/progressive-svg";

type SvgGenerationParameters = {
  svgGenerationRequest: GenerationRequest;
  signal: AbortSignal;
  onProgress: (characters: number) => void;
  onEvent?: (event: GenerationEvent) => void;
  model?: LanguageModel;
  webSearch?: ReturnType<typeof createWebSearch>;
  collectionRetrievalContext?: Retrieval;
};

export async function streamSvgGenerationOnServer({
  svgGenerationRequest,
  signal,
  onProgress,
  model = getLLM(),
  onEvent,
  webSearch = createWebSearch(),
  collectionRetrievalContext,
}: SvgGenerationParameters): ReturnType<ServerSvgGenerator> {
  const agent = createSvgAgent({
    model,
    currentSvg: svgGenerationRequest.currentSvg,
    webSearch,
  });
  const result = await agent.stream({
    messages: buildSvgAgentMessages({
      svgGenerationRequest,
      collectionRetrievalContext,
    }),
    abortSignal: signal,
  });
  let characters = 0;
  let lastUpdate = 0;
  let lastPreview = "";
  let step = 0;
  let text = "";
  let stepTools: string[] = [];
  let lastResponse = "";
  const toolInputs = new Map<string, { name: string; text: string }>();
  function emitProgressAndSafePreview({
    streamedJson,
    forceUpdate = false,
    containsResponseMetadata = false,
  }: {
    streamedJson: string;
    forceUpdate?: boolean;
    containsResponseMetadata?: boolean;
  }) {
    if (!forceUpdate && Date.now() - lastUpdate < 250) return;
    onProgress(characters);
    lastUpdate = Date.now();
    // Only the structured public message is streamed; never reasoning deltas.
    if (containsResponseMetadata) {
      const message = readStreamedSvg(streamedJson, "message")?.slice(0, 2000);
      if (message && message !== lastResponse) {
        lastResponse = message;
        onEvent?.({ type: "response", step, text: message });
      }
    }
    const source = containsResponseMetadata
      ? null
      : readStreamedSvg(streamedJson);
    const svg = source && createSvgPreview(source);
    if (svg && svg.source !== lastPreview) {
      lastPreview = svg.source;
      onEvent?.({ type: "preview", svg });
    }
  }
  for await (const part of result.fullStream) {
    if (part.type === "error") throw part.error;
    if (part.type === "start-step") {
      step++;
      text = "";
      stepTools = [];
      lastResponse = "";
      onEvent?.({
        type: "step",
        detail: {
          step,
          status: "running",
          description: "The model is processing this step.",
        },
      });
      onEvent?.({ type: "activity", step, action: "working" });
    }
    if (part.type === "tool-input-start") {
      toolInputs.set(part.id, { name: part.toolName, text: "" });
      if (
        part.toolName === "querySvg" ||
        part.toolName === "validateSvg" ||
        part.toolName === "webSearch"
      ) {
        onEvent?.({ type: "activity", step, action: part.toolName });
        onEvent?.({
          type: "tool",
          call: { id: part.id, name: part.toolName, step, status: "pending" },
        });
      }
    }
    if (part.type === "tool-input-delta") {
      characters += part.delta.length;
      const toolInput = toolInputs.get(part.id);
      if (toolInput) {
        toolInput.text += part.delta;
        if (toolInput.name === "validateSvg")
          emitProgressAndSafePreview({ streamedJson: toolInput.text });
      }
    }
    if (part.type === "tool-input-end") {
      const toolInput = toolInputs.get(part.id);
      if (toolInput?.name === "validateSvg")
        emitProgressAndSafePreview({
          streamedJson: toolInput.text,
          forceUpdate: true,
        });
      toolInputs.delete(part.id);
    }
    if (part.type === "tool-call") stepTools.push(part.toolName);
    if (
      part.type === "tool-call" ||
      part.type === "tool-result" ||
      part.type === "tool-error"
    ) {
      if (
        part.toolName === "querySvg" ||
        part.toolName === "validateSvg" ||
        part.toolName === "webSearch"
      ) {
        const parsed = toolTraceSchema.safeParse({
          id: part.toolCallId,
          name: part.toolName,
          step,
          status:
            part.type === "tool-call"
              ? "running"
              : part.type === "tool-result"
                ? "completed"
                : "error",
          ...(part.type === "tool-call" ? { input: part.input } : {}),
          ...(part.type === "tool-result" ? { output: part.output } : {}),
          ...(part.type === "tool-error"
            ? { error: "The tool could not complete this call." }
            : {}),
        });
        // Never expose raw SDK/provider errors or malformed tool arguments.
        onEvent?.({
          type: "tool",
          call: parsed.success
            ? parsed.data
            : {
                id: part.toolCallId,
                name: part.toolName,
                step,
                status: "error",
                error: "The tool call contained unsupported input or output.",
              },
        });
      }
    }
    if (part.type === "text-delta") {
      characters += part.text.length;
      text += part.text;
      emitProgressAndSafePreview({
        streamedJson: text,
        containsResponseMetadata: true,
      });
    }
    if (part.type === "finish-step") {
      emitProgressAndSafePreview({
        streamedJson: text,
        forceUpdate: true,
        containsResponseMetadata: true,
      });
      let description = stepTools.length
        ? `Called ${stepTools.join(", ")}; the tool results are available for the next model step.`
        : "The model returned its final response.";
      if (part.finishReason === "length")
        description = "The model reached the output token limit for this step.";
      if (part.finishReason === "error")
        description = "The model stopped with an error.";
      // Only a public response message may be shown. Never forward reasoning
      // deltas, provider metadata or an unparsed model transcript.
      if (!stepTools.length) {
        try {
          const response: unknown = JSON.parse(text);
          if (
            response &&
            typeof response === "object" &&
            "message" in response &&
            typeof response.message === "string"
          ) {
            description = response.message.trim().slice(0, 2000) || description;
          }
        } catch {
          /* A partial/invalid response is still checked by the final validator. */
        }
      }
      onEvent?.({
        type: "step",
        detail: { step, status: "completed", description },
      });
    }
    if (characters > MAX_STREAM_OUTPUT_CHARACTERS)
      throw new Error("Output limit exceeded");
  }
  const metadata = await result.output;
  const svg = agent.getLatestValidatedSvgProposal();
  if (!svg)
    throw new Error("The agent did not finish with a validated SVG proposal.");
  return {
    output: { ...metadata, svg },
    usage: summarizeUsage(
      typeof model === "string" ? model : model.modelId,
      await result.totalUsage,
    ),
  };
}
