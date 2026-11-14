import "server-only";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { resolve } from "node:path";
import { createOpenAI } from "@ai-sdk/openai";
import { registerTelemetry } from "ai";
import {
  Eval,
  braintrustAISDKTelemetry,
  type EvalResultWithSummary,
  type EvalScorer,
} from "braintrust";
import { modelDefaults } from "../lib/ai/config";
import { getLLM } from "../lib/ai/model";
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
import { prepareReview } from "./review-artifacts";
import {
  buildEvalReport,
  compareReports,
  type EvalObservation,
} from "./report";

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
      trials: { type: "string", default: "1" },
      split: { type: "string", default: "all" },
      model: { type: "string" },
      compare: { type: "string" },
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
  const trials = Number(values.trials);
  if (!Number.isInteger(trials) || trials < 1 || trials > 3)
    throw new EvalSetupError("--trials must be 1, 2, or 3.");
  if (!["all", "holdout", "development"].includes(values.split!))
    throw new EvalSetupError("--split must be all, holdout, or development.");
  const cases = dataset.filter(
    (item) =>
      (values.split === "all" ||
        (values.split === "holdout") === item.expected.holdout) &&
      (!values.case || item.id === values.case) &&
      (!values.tag || item.tags.includes(values.tag)),
  );
  if (!cases.length) throw new EvalSetupError("No cases match your filters.");
  if (cases.length > evalConfig.maxCases)
    throw new EvalSetupError(
      `Select at most ${evalConfig.maxCases} cases using --case, --tag, or --split, or deliberately edit evals/config.ts.`,
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
  if (values.model) process.env.OPENAI_MODEL = values.model;
  if (values.braintrust && !process.env.BRAINTRUST_API_KEY?.trim())
    throw new EvalSetupError(
      "Set BRAINTRUST_API_KEY in .env.local before uploading an eval.",
    );

  // Register tracing only in this CLI process, never in browser or app requests.
  if (values.braintrust) registerTelemetry(braintrustAISDKTelemetry());
  const model = getLLM();
  const judgeModel =
    process.env.EVAL_JUDGE_MODEL?.trim() || modelDefaults.evalJudge;
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
    braintrustUpload: values.braintrust,
    generatorModel: typeof model === "string" ? model : model.modelId,
    policyModels: {
      scope: modelDefaults.scope,
      moderation: modelDefaults.moderation,
    },
    judgeModel: values.judge ? judgeModel : null,
    datasetHash: hash(datasetText),
    agentHash: hash(await readFile("lib/ai/svg-agent.ts", "utf8")),
    judgePromptHash: hash(await readFile("evals/judge-prompt.ts", "utf8")),
    rendererHash: hash(await readFile("lib/svg/render-svg.ts", "utf8")),
    policyHash: hash(await readFile("lib/ai/input-policy.ts", "utf8")),
    evalTaskHash: hash(await readFile("evals/task.ts", "utf8")),
    runnerHash: hash(await readFile("evals/run.ts", "utf8")),
    scorerHash: hash(
      (await readFile("evals/scorers.ts", "utf8")) +
        (await readFile("evals/vision-scorer.ts", "utf8")) +
        (await readFile("evals/report.ts", "utf8")) +
        (await readFile("evals/types.ts", "utf8")),
    ),
    selectedCases: cases.map((item) => item.id),
  };
  let pairedReference: {
    directory: string;
    report: ReturnType<typeof buildEvalReport>;
  } | null = null;
  if (values.compare) {
    const referenceDirectory = resolve(values.compare);
    let reference: {
      metadata: Record<string, unknown>;
      report: ReturnType<typeof buildEvalReport>;
    };
    try {
      reference = JSON.parse(
        await readFile(resolve(referenceDirectory, "comparison.json"), "utf8"),
      ) as typeof reference;
    } catch {
      throw new EvalSetupError(
        "--compare must point to a previous run directory containing comparison.json.",
      );
    }
    const pinnedFields = [
      "suiteVersion",
      "datasetHash",
      "scorerHash",
      "rendererHash",
      "policyHash",
      "evalTaskHash",
      "runnerHash",
      "judgePromptHash",
      "judgeModel",
      "policyModels",
      "judge",
      "selectedCases",
    ];
    if (
      pinnedFields.some(
        (field) =>
          JSON.stringify(reference.metadata[field]) !==
          JSON.stringify((metadata as Record<string, unknown>)[field]),
      )
    )
      throw new EvalSetupError(
        "Paired comparison requires matching data, scorer, renderer, policy and judge settings.",
      );
    pairedReference = {
      directory: referenceDirectory,
      report: reference.report,
    };
  }
  const createScoreAdapters = (details: Record<string, Score[]>) =>
    scorers.map((scorer) => {
      const adapter: EvalScorer<
        EvalCase,
        EvalOutput,
        EvalCase["expected"]
      > = async ({ input, output }) => {
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
      };
      return Object.defineProperty(adapter, "name", { value: scorer.name });
    });
  const directory = resolve("evals/runs", stamp);
  await mkdir(directory, { recursive: true });
  const trialResults: Array<{
    metadata: typeof metadata;
    result: EvalResultWithSummary<EvalCase, EvalOutput, EvalCase["expected"]>;
    details: Record<string, Score[]>;
  }> = [];
  console.log(
    `Running ${trials} sequential trial(s). Braintrust upload: ${values.braintrust}. Vision judge: ${values.judge}.`,
  );
  for (let trial = 1; trial <= trials; trial++) {
    const details: Record<string, Score[]> = {};
    const trialMetadata = { ...metadata, trial, trialCount: trials };
    const result = await Eval<EvalCase, EvalOutput, EvalCase["expected"]>(
      process.env.BRAINTRUST_PROJECT || "svg-ai-agent",
      {
        experimentName: `${experimentName}-trial-${trial}`,
        data: cases.map((item) => ({
          input: item,
          expected: item.expected,
          tags: item.tags,
          metadata: { caseId: item.id, trial },
        })),
        task: createEvalTask(model),
        scores: [
          ...createScoreAdapters(details),
          function human_review() {
            return [
              { name: "human_visual_quality", score: null },
              { name: "human_acceptable", score: null },
            ];
          },
        ],
        metadata: trialMetadata,
        maxConcurrency: 1,
        trialCount: 1,
        isPublic: false,
      },
      { noSendLogs: !values.braintrust },
    );
    trialResults.push({ metadata: trialMetadata, result, details });
    const trialDirectory = resolve(
      directory,
      `trial-${String(trial).padStart(2, "0")}`,
    );
    await mkdir(trialDirectory, { recursive: true });
    await writeFile(
      resolve(trialDirectory, "results.json"),
      JSON.stringify(
        {
          metadata: trialMetadata,
          summary: result.summary,
          results: result.results,
          scorerDetails: details,
        },
        null,
        2,
      ),
    );
    for (const row of result.results)
      if (row.output?.source)
        await writeFile(
          resolve(trialDirectory, `${row.input.id}.svg`),
          row.output.source,
        );
    await prepareReview(trialDirectory);
  }

  const observationsByCase: Record<string, EvalObservation[]> = {};
  const failures: string[] = [];
  for (const [trialIndex, { result, details }] of trialResults.entries())
    for (const row of result.results) {
      const scoreMetadata = Object.fromEntries(
        (details[row.input.id] ?? []).map((score) => [
          score.name,
          score.metadata,
        ]),
      );
      const observation: EvalObservation = {
        trial: trialIndex + 1,
        status: row.output?.status ?? "missing",
        policy: row.output?.policy ?? "unavailable",
        latencyMs: row.output?.metrics?.durationMs ?? null,
        firstPreviewMs: row.output?.metrics?.firstPreviewMs ?? null,
        inputTokens: row.output?.usage?.inputTokens ?? null,
        outputTokens: row.output?.usage?.outputTokens ?? null,
        scores: Object.fromEntries(
          Object.entries(row.scores).filter(
            ([name]) =>
              !["human_visual_quality", "human_acceptable"].includes(name),
          ),
        ),
        scoreMetadata,
      };
      (observationsByCase[row.input.id] ??= []).push(observation);
      for (const [name, score] of Object.entries(observation.scores))
        if (score !== null && score < 1)
          failures.push(
            `${row.input.id} trial ${trialIndex + 1}: ${name}=${score}`,
          );
      if (row.output?.error)
        failures.push(
          `${row.input.id} trial ${trialIndex + 1}: ${row.output.error}`,
        );
    }
  const report = buildEvalReport(cases, observationsByCase);
  const comparison: Record<string, unknown> = {
    metadata: {
      ...metadata,
      trials,
      selectedCaseCount: cases.length,
      split: values.split,
    },
    report,
    failures,
  };
  if (pairedReference)
    Object.assign(comparison, {
      pairedAgainst: pairedReference.directory,
      paired: compareReports(pairedReference.report, report),
    });
  await writeFile(
    resolve(directory, "comparison.json"),
    JSON.stringify(comparison, null, 2),
  );
  console.log(`Results and paired comparison saved to ${directory}`);
  console.log(
    `Human review files prepared per trial. Unavailable scorer results: ${report.missingScores}. Failed checks: ${failures.length}.`,
  );
  for (const { result } of trialResults)
    if (result.summary.experimentUrl)
      console.log(`Braintrust: ${result.summary.experimentUrl}`);
  if (failures.length) process.exitCode = 1;
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
