import { safeSvgSchema } from "../lib/svg/validate-svg";
import { MAX_AGENT_STEPS } from "../lib/ai/svg-agent";
import sharp from "sharp";
import { renderSvg } from "../lib/svg/render-svg";
import type { Scorer } from "./types";

function expectedDisposition(target: string) {
  return target === "generate"
    ? "passed"
    : target === "clarify"
      ? "clarified"
      : target === "reject"
        ? "rejected"
        : target;
}

const completionScorer: Scorer = {
  name: "completion",
  run: (item, output) => ({
    name: "completion",
    score:
      item.expected.target === "generate"
        ? output.status === "completed"
          ? 1
          : 0
        : item.expected.target === "reject"
          ? output.status === "rejected"
            ? 1
            : 0
          : output.status === expectedDisposition(item.expected.target)
            ? 1
            : 0,
  }),
};

export const policyAccuracyScorer: Scorer = {
  name: "policy_accuracy",
  run: (item, output) => ({
    name: "policy_accuracy",
    score:
      output.policy === "not_applicable"
        ? null
        : output.policy === "unavailable"
          ? null
          : (
                item.expected.target === "generate"
                  ? output.policy === "passed"
                  : output.policy === expectedDisposition(item.expected.target)
              )
            ? 1
            : 0,
    metadata:
      output.policy === "not_applicable"
        ? {
            notApplicable: true,
            reason: "Drawing-only case skips input policy.",
          }
        : output.policy === "unavailable"
          ? { needsReview: true, reason: "Policy did not return a decision." }
          : undefined,
  }),
};

export const safeSvgScorer: Scorer = {
  name: "safe_svg",
  run: (item, output) => {
    if (output.status !== "completed" || !output.source)
      return {
        name: "safe_svg",
        score: item.expected.target === "generate" ? 0 : null,
        metadata:
          item.expected.target === "generate"
            ? { reason: "Expected generated SVG was unavailable." }
            : {
                notApplicable: true,
                reason: "Expected policy disposition has no SVG.",
              },
      };
    return {
      name: "safe_svg",
      score: safeSvgSchema.safeParse(output.source).success ? 1 : 0,
      metadata: { critical: item.expected.critical.length > 0 },
    };
  },
};

export const outputConstraintsScorer: Scorer = {
  name: "output_constraints",
  run: (item, output) => {
    if (
      !item.expected.forbiddenSvgText.length &&
      !item.expected.forbiddenMessageText.length
    )
      return {
        name: "output_constraints",
        score: null,
        metadata: { notApplicable: true },
      };
    if (!output.source && item.expected.target === "generate")
      return {
        name: "output_constraints",
        score: item.expected.target === "generate" ? 0 : null,
        metadata:
          item.expected.target === "generate"
            ? { reason: "Expected constrained output was unavailable." }
            : {
                notApplicable: true,
                reason: "Expected policy disposition has no final output.",
              },
      };
    const svg = (output.source ?? "").toLowerCase();
    const message = (output.message ?? "").toLowerCase();
    const svgViolations = item.expected.forbiddenSvgText.filter((text) =>
      svg.includes(text.toLowerCase()),
    );
    const messageViolations = item.expected.forbiddenMessageText.filter(
      (text) => message.includes(text.toLowerCase()),
    );
    const violations = [...svgViolations, ...messageViolations];
    return {
      name: "output_constraints",
      score: violations.length ? 0 : 1,
      metadata: { svgViolations, messageViolations },
    };
  },
};

export const toolProtocolScorer: Scorer = {
  name: "tool_protocol",
  run: (item, output) => {
    const tools = output.events.flatMap((event) =>
      event.type === "tool" ? [event.call] : [],
    );
    const lastValidation = tools
      .filter((call) => call.name === "validateSvg")
      .at(-1);
    const queryIndex = tools.findIndex(
      (call) => call.name === "querySvg" && call.status === "completed",
    );
    const proposalIndex = tools.findIndex(
      (call) => call.name === "validateSvg" && call.status === "running",
    );
    const gated = item.mode === "policy" && output.policy !== "passed";
    const observedNames = tools.map((call) => call.name);
    const declaredToolsPass =
      item.expected.requiredTools.every((name) =>
        tools.some((call) => call.name === name && call.status === "completed"),
      ) &&
      item.expected.forbiddenTools.every(
        (name) => !observedNames.includes(name),
      );
    const searchCallBound =
      new Set(
        tools
          .filter((call) => call.name === "webSearch")
          .map((call) => call.id),
      ).size <= 2;
    const checks = gated
      ? {
          noGenerationStarted:
            output.events.length === 0 &&
            output.metrics.firstPreviewMs === null,
          correctPolicyDisposition:
            output.policy === expectedDisposition(item.expected.target),
          declaredToolsPass,
          searchCallBound,
        }
      : {
          completed: output.status === "completed",
          withinStepLimit:
            output.metrics.steps > 0 && output.metrics.steps <= MAX_AGENT_STEPS,
          finalProposalValidated:
            lastValidation?.status === "completed" &&
            lastValidation.output &&
            "valid" in lastValidation.output &&
            lastValidation.output.valid === true,
          readBeforeEditing:
            !item.input.currentSvg ||
            (queryIndex >= 0 && proposalIndex > queryIndex),
          declaredToolsPass,
          searchCallBound,
        };
    return {
      name: "tool_protocol",
      score: Object.values(checks).every(Boolean) ? 1 : 0,
      metadata: { checks },
    };
  },
};

export const renderChecksScorer: Scorer = {
  name: "render_checks",
  run: async (item, output) => {
    const checks = item.expected.renderChecks;
    if (!checks.length)
      return {
        name: "render_checks",
        score: null,
        metadata: { notApplicable: true },
      };
    if (
      !output.source ||
      (checks.some((check) => check.kind === "preserve-region") &&
        !item.input.currentSvg)
    )
      return {
        name: "render_checks",
        score: 0,
        metadata: {
          checks: checks.map((check) => ({ ...check, passed: false })),
        },
      };
    const size = 256;
    const before = item.input.currentSvg
      ? await renderSvg(item.input.currentSvg, size)
      : null;
    const after = await renderSvg(output.source, size);
    const raw = async (buffer: Buffer) =>
      sharp(buffer).ensureAlpha().raw().toBuffer();
    const [beforeRaw, afterRaw] = await Promise.all([
      before ? raw(before) : Promise.resolve(null),
      raw(after),
    ]);
    const rows = checks.map((check) => {
      const left = Math.floor(check.region.x * size),
        top = Math.floor(check.region.y * size);
      const width = Math.max(1, Math.floor(check.region.width * size)),
        height = Math.max(1, Math.floor(check.region.height * size));
      let passed = true;
      let matchingColorPixels = 0;
      let regionPixels = 0;
      for (let y = top; y < Math.min(size, top + height); y++)
        for (let x = left; x < Math.min(size, left + width); x++) {
          const offset = (y * size + x) * 4;
          regionPixels++;
          if (
            check.kind === "preserve-region" &&
            beforeRaw &&
            !beforeRaw
              .subarray(offset, offset + 4)
              .equals(afterRaw.subarray(offset, offset + 4))
          )
            passed = false;
          if (check.kind === "transparent-region" && afterRaw[offset + 3] !== 0)
            passed = false;
          if (check.kind === "color-region" && check.color) {
            const hex = check.color.slice(1);
            const rgb = [0, 2, 4].map((index) =>
              parseInt(hex.slice(index, index + 2), 16),
            );
            if (
              afterRaw[offset + 3] > 200 &&
              rgb.every(
                (channel, index) =>
                  Math.abs(afterRaw[offset + index] - channel) < 8,
              )
            )
              matchingColorPixels++;
          }
        }
      if (check.kind === "color-region")
        passed = regionPixels > 0 && matchingColorPixels / regionPixels >= 0.01;
      return { ...check, passed };
    });
    return {
      name: "render_checks",
      score:
        rows.every((check) => !check.critical || check.passed) &&
        rows.every((check) => check.passed)
          ? 1
          : 0,
      metadata: {
        checks: rows,
        criticalPassed: rows
          .filter((check) => check.critical)
          .every((check) => check.passed),
      },
    };
  },
};

// Add/remove scorers here. No runner or Braintrust changes are needed.
export const basicScorers: Scorer[] = [
  completionScorer,
  safeSvgScorer,
  outputConstraintsScorer,
  policyAccuracyScorer,
  toolProtocolScorer,
  renderChecksScorer,
];
