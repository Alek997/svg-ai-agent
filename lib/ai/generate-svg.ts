import "server-only";

import type { LanguageModel } from "ai";
import { buildSvgMessages, createSvgAgent } from "./svg-agent";
import { getLLM } from "./model";
import { summarizeUsage } from "./usage";
import type { GenerateSvg } from "./handle-generation";
import type { GenerationRequest } from "../workspace/contracts";

export async function generateSvg(
  input: GenerationRequest,
  signal: AbortSignal,
  onProgress: (characters: number) => void,
  model: LanguageModel = getLLM(),
): ReturnType<GenerateSvg> {
  const result = await createSvgAgent(model).stream({
    messages: buildSvgMessages(input),
    abortSignal: signal,
  });
  let characters = 0;
  let lastUpdate = 0;
  // Consume fullStream so provider errors are thrown and never exposed verbatim.
  for await (const part of result.fullStream) {
    if (part.type === "error") throw part.error;
    if (part.type === "text-delta") {
      characters += part.text.length;
      if (characters > 64_000) throw new Error("Output limit exceeded");
      if (Date.now() - lastUpdate >= 250) {
        onProgress(characters);
        lastUpdate = Date.now();
      }
    }
  }
  return {
    output: await result.output,
    usage: summarizeUsage(typeof model === "string" ? model : model.modelId, await result.totalUsage),
  };
}
