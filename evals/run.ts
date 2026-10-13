import "server-only";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { resolve } from "node:path";
import { createOpenAI } from "@ai-sdk/openai";
import { registerTelemetry } from "ai";
import { Eval, braintrustAISDKTelemetry, type EvalScorer } from "braintrust";
import { DEFAULT_OPENAI_MODEL, getLLM } from "../lib/ai/model";
import { evalConfig } from "./config";
import {
  datasetSchema,
  type EvalCase,
  type EvalOutput,
  type Score,
} from "./types";
import { createEvalTask } from "./task";
import { basicScorers } from "./scorers";
import { createVisionScorer } from "./vision-scorer";

class EvalSetupError extends Error {}

async function main() {
  const { values } = parseArgs({
    options: {
      live: { type: "boolean", default: false },
      braintrust: { type: "boolean", default: false },
      judge: { type: "boolean", default: false },
      case: { type: "string" },
      tag: { type: "string" },
      dataset: { type: "string", default: "evals/cases.json" },
      name: { type: "string" },
    },
  });
  // Node's loader keeps existing shell env values. This CLI only reads .env.local.
  if (existsSync(".env.local")) process.loadEnvFile(".env.local");
  const datasetText = await readFile(resolve(values.dataset!), "utf8");
  const parsed = datasetSchema.safeParse(JSON.parse(datasetText));
  if (!parsed.success)
    throw new EvalSetupError(
      "Dataset validation failed. Check unique ids, valid requests/starting SVGs, tags, and nonempty requirement lists.",
    );
  const dataset = parsed.data;
  const cases = dataset.filter(
    (item) =>
      (!values.case || item.id === values.case) &&
      (!values.tag || item.tags.includes(values.tag)),
  );
  if (!cases.length) throw new EvalSetupError("No cases match your filters.");
  if (cases.length > evalConfig.maxCases)
    throw new EvalSetupError(
      `Select at most ${evalConfig.maxCases} cases using --case or --tag, or deliberately edit evals/config.ts.`,
    );
  console.log(
    `Selected ${cases.length} case(s): ${cases.map((item) => item.id).join(", ")}`,
  );
  console.log(
    `Scorers: ${[...basicScorers.map((scorer) => scorer.name), ...(values.judge ? ["prompt_fidelity"] : [])].join(", ")}`,
  );
  if (!values.live) {
    console.log(
      "Dataset validated. No models called and nothing uploaded. Add --live to generate; --judge for visual scoring; --braintrust to upload.",
    );
    return;
  }
  if (!process.env.OPENAI_API_KEY?.trim())
    throw new EvalSetupError(
      "Set OPENAI_API_KEY in .env.local before a live eval.",
    );
  if (values.braintrust && !process.env.BRAINTRUST_API_KEY?.trim())
    throw new EvalSetupError(
      "Set BRAINTRUST_API_KEY in .env.local before uploading an eval.",
    );

  // Register tracing only in this CLI process, never in browser or app requests.
  if (values.braintrust) registerTelemetry(braintrustAISDKTelemetry());
  const model = getLLM();
  const judgeModel =
    process.env.EVAL_JUDGE_MODEL?.trim() || DEFAULT_OPENAI_MODEL;
  const scorers = [...basicScorers];
  if (values.judge)
    scorers.push(
      createVisionScorer(
        createOpenAI({ apiKey: process.env.OPENAI_API_KEY }).responses(
          judgeModel,
        ),
      ),
    );
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const experimentName = `${values.name || evalConfig.suiteVersion}-${stamp}`;
  const hash = (text: string) =>
    createHash("sha256").update(text).digest("hex");
  const metadata = {
    ...evalConfig,
    generatorModel: typeof model === "string" ? model : model.modelId,
    judgeModel: values.judge ? judgeModel : null,
    datasetHash: hash(datasetText),
    agentHash: hash(await readFile("lib/ai/svg-agent.ts", "utf8")),
    judgePromptHash: hash(await readFile("evals/judge-prompt.ts", "utf8")),
    scorerHash: hash(
      (await readFile("evals/scorers.ts", "utf8")) +
        (await readFile("evals/vision-scorer.ts", "utf8")),
    ),
    selectedCases: cases.map((item) => item.id),
  };
  const details: Record<string, Score[]> = {};
  const scoreAdapters: EvalScorer<
    EvalCase,
    EvalOutput,
    EvalCase["expected"]
  >[] = scorers.map((scorer) => async ({ input, output }) => {
    let score: Score;
    try {
      score = await scorer.run(input, output);
    } catch {
      score = {
        name: scorer.name,
        score: null,
        metadata: { needsReview: true, reason: "Scorer failed." },
      };
    }
    (details[input.id] ??= []).push(score);
    return score;
  });
  console.log(
    `Running one generation per case, sequentially. Braintrust upload: ${values.braintrust}. Vision judge: ${values.judge}.`,
  );
  const result = await Eval(
    process.env.BRAINTRUST_PROJECT || "svg-ai-agent",
    {
      experimentName,
      data: cases.map((item) => ({
        input: item,
        expected: item.expected,
        tags: item.tags,
        metadata: { caseId: item.id },
      })),
      task: createEvalTask(model),
      scores: scoreAdapters,
      metadata,
      maxConcurrency: 1,
      trialCount: 1,
      isPublic: false,
    },
    { noSendLogs: !values.braintrust },
  );
  // Use a generated safe directory name; user experiment labels never become paths.
  const directory = resolve("evaluations/runs", stamp);
  await mkdir(directory, { recursive: true });
  await writeFile(
    resolve(directory, "results.json"),
    JSON.stringify(
      {
        metadata,
        summary: result.summary,
        results: result.results,
        scorerDetails: details,
      },
      null,
      2,
    ),
  );
  for (const row of result.results) {
    if (row.output?.status === "completed" && row.output.source) {
      await writeFile(
        resolve(directory, `${row.input.id}.svg`),
        row.output.source,
      );
    }
  }
  console.log(`Results saved to ${directory}`);
  if (result.summary.experimentUrl)
    console.log(`Braintrust: ${result.summary.experimentUrl}`);
  if (
    result.results.some(
      (row) =>
        row.error ||
        row.output?.status !== "completed" ||
        Object.values(row.scores).some((score) => score === null || score < 1),
    )
  )
    process.exitCode = 1;
}

main().catch((error) => {
  // Print setup errors separately from provider/SDK exceptions; never dump secrets.
  console.error(
    error instanceof EvalSetupError
      ? error.message
      : "Eval could not finish. Check dataset/flags, required .env.local values, and provider/Braintrust connectivity. No raw SDK error was logged.",
  );
  process.exitCode = 1;
});
