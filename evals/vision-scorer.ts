import "server-only";
import { generateText, Output, type LanguageModel } from "ai";
import sharp from "sharp";
import { z } from "zod";
import { safeSvgSchema } from "../lib/svg/validate-svg";
import { summarizeUsage } from "../lib/ai/usage";
import { evalConfig } from "./config";
import { judgePrompt } from "./judge-prompt";
import type { EvalCase, Score, Scorer } from "./types";

export const judgmentSchema = z.object({
  checks: z.array(z.object({
    index: z.number().int().min(0).max(19),
    verdict: z.enum(["pass", "fail", "uncertain"]),
    evidence: z.string().trim().min(1).max(500),
  }).strict()).min(1).max(20),
}).strict();

// Validate before handing untrusted XML to a renderer. Bound raster size too.
export async function renderSvg(source: string): Promise<Buffer> {
  const safe = safeSvgSchema.parse(source);
  return sharp(Buffer.from(safe.source), { limitInputPixels: 4096 * 4096 })
    .resize(evalConfig.judge.imageSize, evalConfig.judge.imageSize, { fit: "contain", background: "#e5e7eb" })
    .flatten({ background: "#e5e7eb" }).png().toBuffer();
}

export function scoreJudgment(requirements: string[], raw: unknown): Score {
  const result = judgmentSchema.safeParse(raw);
  if (!result.success || result.data.checks.length !== requirements.length ||
    new Set(result.data.checks.map(check => check.index)).size !== requirements.length ||
    result.data.checks.some(check => check.index >= requirements.length)) {
    return { name: "prompt_fidelity", score: null, metadata: { needsReview: true, reason: "Judge returned an incomplete or invalid checklist." } };
  }
  const checks = result.data.checks.map(check => ({ ...check, requirement: requirements[check.index] }));
  const uncertain = checks.some(check => check.verdict === "uncertain");
  return {
    name: "prompt_fidelity",
    score: uncertain ? null : checks.filter(check => check.verdict === "pass").length / requirements.length,
    metadata: { checks, needsReview: uncertain, allRequirementsPassed: checks.every(check => check.verdict === "pass") },
  };
}

type Judge = (item: EvalCase, images: Buffer[]) => Promise<{ judgment: unknown; metadata?: Record<string, unknown> }>;

export function createVisionScorer(model: LanguageModel, judge: Judge = async (item, images) => {
  const result = await generateText({
    model,
    system: judgePrompt,
    messages: [{ role: "user", content: [
      { type: "text", text: JSON.stringify({ request: item.input.messages.at(-1)?.content, requirements: item.expected.requirements.map((requirement, index) => ({ index, requirement })) }) },
      ...images.map(image => ({ type: "file" as const, data: image, mediaType: "image/png" })),
    ] }],
    output: Output.object({ schema: judgmentSchema }),
    maxOutputTokens: evalConfig.judge.maxOutputTokens,
    maxRetries: 0,
    timeout: evalConfig.judge.timeoutMs,
    providerOptions: { openai: { store: false } },
  });
  return { judgment: result.output, metadata: { usage: summarizeUsage(typeof model === "string" ? model : model.modelId, result.totalUsage) } };
}): Scorer {
  return {
    name: "prompt_fidelity",
    run: async (item, output) => {
      if (output.status !== "completed" || !output.source || !safeSvgSchema.safeParse(output.source).success) {
        return { name: "prompt_fidelity", score: 0, metadata: { reason: "No safe completed artwork to evaluate." } };
      }
      try {
        const start = performance.now();
        const images = [await renderSvg(output.source)];
        if (item.input.currentSvg) images.push(await renderSvg(item.input.currentSvg));
        const result = await judge(item, images);
        const score = scoreJudgment(item.expected.requirements, result.judgment);
        return { ...score, metadata: { ...score.metadata, ...result.metadata, durationMs: Math.round(performance.now() - start), rubricVersion: evalConfig.judge.rubricVersion } };
      } catch {
        // A failed judge/render is unavailable, not evidence of poor artwork.
        return { name: "prompt_fidelity", score: null, metadata: { needsReview: true, reason: "Rendering or judging failed. No automatic judge retry." } };
      }
    },
  };
}
