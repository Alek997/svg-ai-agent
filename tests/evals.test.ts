import assert from "node:assert/strict";
import { test } from "node:test";
import { Eval, braintrustAISDKTelemetry } from "braintrust";
import { registerTelemetry } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import sharp from "sharp";
import cases from "../evals/cases.json";
import { datasetSchema, type EvalCase, type EvalOutput } from "../evals/types";
import { createEvalTask } from "../evals/task";
import { basicScorers, toolProtocolScorer, safeSvgScorer } from "../evals/scorers";
import { createVisionScorer, renderSvg, scoreJudgment } from "../evals/vision-scorer";

const dataset = datasetSchema.parse(cases);
const item = dataset[0];
const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="30" fill="blue"/></svg>';
const usage = { model: "mock", inputTokens: 10, outputTokens: 20, cachedInputTokens: 0, totalTokens: 30 };
const output: EvalOutput = {
  status: "completed", source: svg, error: null, usage,
  metrics: { durationMs: 10, firstPreviewMs: 5, steps: 2, validationAttempts: 1 },
  events: [
    { type: "tool", call: { id: "v", name: "validateSvg", step: 1, status: "running", input: { svg } } },
    { type: "tool", call: { id: "v", name: "validateSvg", step: 1, status: "completed", output: { valid: true, version: 1, width: 100, height: 100 } } },
  ],
};

test("dataset rejects duplicate ids, unsafe starting artwork and invalid requests", () => {
  assert.equal(datasetSchema.safeParse([item, item]).success, false);
  assert.equal(datasetSchema.safeParse([{ ...item, input: { ...item.input, currentSvg: "<svg><script/></svg>" } }]).success, false);
  assert.equal(datasetSchema.safeParse([{ ...item, input: { messages: [] } }]).success, false);
});

test("task retains failed rows and redacts provider errors", async () => {
  const task = createEvalTask(undefined, async () => { throw new Error("SECRET provider details"); });
  const result = await task(item);
  assert.equal(result.status, "failed");
  assert.equal(result.usage, null);
  assert.doesNotMatch(JSON.stringify(result), /SECRET/);
  for (const scorer of basicScorers) assert.equal((await scorer.run(item, result)).score, 0);
});

test("task captures preview timing, steps, tool attempts and usage without snapshot payloads", async () => {
  const task = createEvalTask(undefined, async (_, signal, emit) => {
    assert.equal(signal.aborted, false);
    emit({ type: "step", detail: { step: 1, status: "running", description: "Working" } });
    emit({ type: "preview", svg: { source: svg, width: 100, height: 100 } });
    for (const event of output.events) emit(event);
    emit({ type: "step", detail: { step: 2, status: "completed", description: "Done" } });
    return { output: { message: "Circle", filename: "circle.svg", svg }, usage };
  });
  const result = await task(item);
  assert.equal(result.status, "completed");
  assert.equal(result.metrics.steps, 2);
  assert.equal(result.metrics.validationAttempts, 1);
  assert.notEqual(result.metrics.firstPreviewMs, null);
  assert.ok(result.events.every(event => event.type !== "preview"));
  assert.deepEqual(result.usage, usage);
});

test("task independently rejects unsafe final output while retaining incurred usage", async () => {
  const task = createEvalTask(undefined, async () => ({ output: { message: "Done", filename: "circle.svg", svg: svg.replace("<circle", "<script/><circle") }, usage }));
  const result = await task(item);
  assert.equal(result.status, "failed");
  assert.equal(result.source, null);
  assert.deepEqual(result.usage, usage);
  assert.equal((await safeSvgScorer.run(item, { ...output, source: "<svg/>" })).score, 0);
});

test("tool scorer checks read-before-edit, latest validation and step bounds", async () => {
  const edit = dataset.find(item => item.id === "edit-circle")!;
  assert.equal((await toolProtocolScorer.run(edit, output)).score, 0);
  const queried: EvalOutput = { ...output, events: [
    { type: "tool", call: { id: "q", name: "querySvg", step: 1, status: "completed", output: { source: edit.input.currentSvg!, version: 0 } } },
    ...output.events,
  ] };
  assert.equal((await toolProtocolScorer.run(edit, queried)).score, 1);
  assert.equal((await toolProtocolScorer.run(edit, { ...queried, metrics: { ...queried.metrics, steps: 7 } })).score, 0);
  assert.equal((await toolProtocolScorer.run(edit, { ...queried, events: [...queried.events,
    { type: "tool", call: { id: "bad", name: "validateSvg", step: 3, status: "completed", output: { valid: false, error: "Malformed" } } },
  ] })).score, 0);
});

test("fidelity uses checklist verdicts, rejects missing/duplicate checks and flags uncertainty", () => {
  const requirements = ["Blue circle", "Centered"];
  const checks = [{ index: 0, verdict: "pass", evidence: "Blue circle visible" }, { index: 1, verdict: "fail", evidence: "Off center" }];
  assert.equal(scoreJudgment(requirements, { checks }).score, 0.5);
  assert.equal(scoreJudgment(requirements, { checks: [checks[0]] }).score, null);
  assert.equal(scoreJudgment(requirements, { checks: [checks[0], checks[0]] }).score, null);
  assert.equal(scoreJudgment(requirements, { checks: [checks[0], { ...checks[1], index: 3 }] }).score, null);
  assert.equal(scoreJudgment(requirements, { checks: [checks[0], { ...checks[1], verdict: "uncertain" }] }).score, null);
});

test("renderer rejects unsafe SVG and produces bounded PNGs", async () => {
  await assert.rejects(renderSvg(svg.replace("<circle", "<script/><circle")));
  const png = await renderSvg(svg);
  const metadata = await sharp(png).metadata();
  assert.equal(metadata.format, "png");
  assert.equal(metadata.width, 512);
  assert.equal(metadata.height, 512);
});

test("vision scorer supplies both images for edits, skips unsafe output and distinguishes judge failures", async () => {
  let calls = 0;
  const scorer = createVisionScorer("mock", async (item, images) => {
    calls++;
    assert.equal(images.length, 2);
    return { judgment: { checks: item.expected.requirements.map((_, index) => ({ index, verdict: "pass", evidence: "Visible in comparison" })) } };
  });
  const edit = dataset.find(item => item.id === "edit-circle")!;
  assert.equal((await scorer.run(edit, output)).score, 1);
  assert.equal((await scorer.run(edit, { ...output, source: "<svg/>" })).score, 0);
  assert.equal(calls, 1);
  const failing = createVisionScorer("mock", async () => { throw new Error("SECRET"); });
  const result = await failing.run(item, output);
  assert.equal(result.score, null);
  assert.doesNotMatch(JSON.stringify(result), /SECRET/);
});

test("real AI SDK judge request works with a mock provider and Braintrust v7 telemetry", async () => {
  registerTelemetry(braintrustAISDKTelemetry());
  const model = new MockLanguageModelV4({ doGenerate: {
    content: [{ type: "text", text: JSON.stringify({ checks: item.expected.requirements.map((_, index) => ({ index, verdict: "pass", evidence: "Visible" })) }) }],
    finishReason: { unified: "stop", raw: "stop" },
    usage: { inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 20, text: 20, reasoning: 0 } },
    warnings: [],
  } });
  const result = await createVisionScorer(model).run(item, output);
  assert.equal(result.score, 1);
  assert.equal(model.doGenerateCalls.length, 1);
  assert.match(JSON.stringify(model.doGenerateCalls[0].prompt), /requirements/);
  assert.equal(model.doGenerateCalls[0].maxOutputTokens, 2000);
});

test("Braintrust runs independent scorers locally with no key and keeps failures in denominator", async () => {
  const result = await Eval<EvalCase, EvalOutput, EvalCase["expected"]>("svg-eval-test", {
    data: [item, dataset[1]].map(input => ({ input, expected: input.expected })),
    task: async input => input.id === item.id ? output : { ...output, status: "failed" as const, source: null },
    scores: basicScorers.map(scorer => async ({ input, output }) => scorer.run(input, output)),
    maxConcurrency: 1,
  }, { noSendLogs: true });
  assert.equal(result.results.length, 2);
  assert.equal(result.results[0].scores.completion, 1);
  assert.equal(result.results[1].scores.completion, 0);
  assert.equal(result.summary.scores.completion.score, 0.5);
});
