import "server-only";

import type { LanguageModel } from "ai";
import { buildSvgMessages, createSvgAgent } from "./svg-agent";
import { getLLM } from "./model";
import { summarizeUsage } from "./usage";
import type { GenerateSvg } from "./handle-generation";
import { toolTraceSchema } from "../workspace/contracts";
import type { GenerationRequest, GenerationEvent } from "../workspace/contracts";
import { createSvgPreview, readStreamedSvg } from "../svg/progressive-svg";

export async function generateSvg(
  input: GenerationRequest,
  signal: AbortSignal,
  onProgress: (characters: number) => void,
  model: LanguageModel = getLLM(),
  onEvent?: (event: GenerationEvent) => void,
): ReturnType<GenerateSvg> {
  const agent = createSvgAgent(model, input.currentSvg);
  const result = await agent.stream({
    messages: buildSvgMessages(input),
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
  function update(json: string, force = false, isResponse = false) {
    if (!force && Date.now() - lastUpdate < 250) return;
    onProgress(characters);
    lastUpdate = Date.now();
    // Only the structured public message is streamed; never reasoning deltas.
    if (isResponse) {
      const message = readStreamedSvg(json, "message")?.slice(0, 2000);
      if (message && message !== lastResponse) {
        lastResponse = message;
        onEvent?.({ type: "response", step, text: message });
      }
    }
    const source = isResponse ? null : readStreamedSvg(json);
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
      onEvent?.({ type: "step", detail: { step, status: "running", description: "The model is processing this step." } });
      onEvent?.({ type: "activity", step, action: "working" });
    }
    if (part.type === "tool-input-start") {
      toolInputs.set(part.id, { name: part.toolName, text: "" });
      if (part.toolName === "querySvg" || part.toolName === "validateSvg") {
        onEvent?.({ type: "activity", step, action: part.toolName });
        onEvent?.({ type: "tool", call: { id: part.id, name: part.toolName, step, status: "pending" } });
      }
    }
    if (part.type === "tool-input-delta") {
      characters += part.delta.length;
      const toolInput = toolInputs.get(part.id);
      if (toolInput) {
        toolInput.text += part.delta;
        if (toolInput.name === "validateSvg") update(toolInput.text);
      }
    }
    if (part.type === "tool-input-end") {
      const toolInput = toolInputs.get(part.id);
      if (toolInput?.name === "validateSvg") update(toolInput.text, true);
      toolInputs.delete(part.id);
    }
    if (part.type === "tool-call") stepTools.push(part.toolName);
    if (part.type === "tool-call" || part.type === "tool-result" || part.type === "tool-error") {
      if (part.toolName === "querySvg" || part.toolName === "validateSvg") {
        const parsed = toolTraceSchema.safeParse({
          id: part.toolCallId, name: part.toolName, step,
          status: part.type === "tool-call" ? "running" : part.type === "tool-result" ? "completed" : "error",
          ...(part.type === "tool-call" ? { input: part.input } : {}),
          ...(part.type === "tool-result" ? { output: part.output } : {}),
          ...(part.type === "tool-error" ? { error: "The tool could not complete this call." } : {}),
        });
        // Never expose raw SDK/provider errors or malformed tool arguments.
        onEvent?.({ type: "tool", call: parsed.success ? parsed.data : {
          id: part.toolCallId, name: part.toolName, step, status: "error",
          error: "The tool call contained unsupported input or output.",
        } });
      }
    }
    if (part.type === "text-delta") {
      characters += part.text.length;
      text += part.text;
      update(text, false, true);
    }
    if (part.type === "finish-step") {
      update(text, true, true);
      let description = stepTools.length
        ? `Called ${stepTools.join(", ")}; the tool results are available for the next model step.`
        : "The model returned its final response.";
      if (part.finishReason === "length") description = "The model reached the output token limit for this step.";
      if (part.finishReason === "error") description = "The model stopped with an error.";
      // Only a public response message may be shown. Never forward reasoning
      // deltas, provider metadata or an unparsed model transcript.
      if (!stepTools.length) {
        try {
          const response: unknown = JSON.parse(text);
          if (response && typeof response === "object" && "message" in response && typeof response.message === "string") {
            description = response.message.trim().slice(0, 2000) || description;
          }
        } catch { /* A partial/invalid response is still checked by the final validator. */ }
      }
      onEvent?.({ type: "step", detail: { step, status: "completed", description } });
    }
    if (characters > 384_000) throw new Error("Output limit exceeded");
  }
  const metadata = await result.output;
  const svg = agent.getValidatedSvg();
  if (!svg) throw new Error("The agent did not finish with a validated SVG proposal.");
  return {
    output: { ...metadata, svg },
    usage: summarizeUsage(typeof model === "string" ? model : model.modelId, await result.totalUsage),
  };
}
