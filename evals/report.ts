import type { EvalCase } from "./types";

export type EvalObservation = {
  trial: number;
  status: string;
  policy: string;
  latencyMs: number | null;
  firstPreviewMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  scores: Record<string, number | null>;
  scoreMetadata: Record<string, Record<string, unknown> | undefined>;
};

function expectedStatus(target: EvalCase["expected"]["target"]) {
  return target === "generate"
    ? "completed"
    : target === "clarify"
      ? "clarified"
      : target === "reject"
        ? "rejected"
        : "conversation";
}

function summarizeScores(observations: EvalObservation[]) {
  const names = [
    ...new Set(observations.flatMap((row) => Object.keys(row.scores))),
  ];
  return Object.fromEntries(
    names.map((name) => {
      const values = observations
        .map((row) => row.scores[name])
        .filter((value): value is number => typeof value === "number");
      const notApplicable = observations.filter(
        (row) =>
          row.scores[name] === null &&
          row.scoreMetadata[name]?.notApplicable === true,
      ).length;
      return [
        name,
        {
          mean: values.length
            ? values.reduce((sum, value) => sum + value, 0) / values.length
            : null,
          min: values.length ? Math.min(...values) : null,
          max: values.length ? Math.max(...values) : null,
          range:
            values.length > 1
              ? Math.max(...values) - Math.min(...values)
              : null,
          availableTrials: values.length,
          unscoredTrials: observations.length - values.length - notApplicable,
          notApplicableTrials: notApplicable,
        },
      ];
    }),
  );
}

export function buildEvalReport(
  cases: EvalCase[],
  observationsByCase: Record<string, EvalObservation[]>,
) {
  const casesById: Record<string, unknown> = {};
  let missingScores = 0;
  const categoryStats = new Map<
    string,
    { cases: number; passes: number; failures: number; incomplete: number }
  >();
  let falseRejections = 0;
  let policyEligible = 0;
  let injectionCases = 0;
  let injectionResistant = 0;
  let fullPasses = 0;
  let fullFailures = 0;
  let fullIncomplete = 0;

  for (const item of cases) {
    const observations = observationsByCase[item.id] ?? [];
    const scoreSummary = summarizeScores(observations);
    const trialRows = observations.map((row) => {
      for (const [name, score] of Object.entries(row.scores))
        if (score === null && row.scoreMetadata[name]?.notApplicable !== true)
          missingScores++;
      const expected = expectedStatus(item.expected.target);
      const dispositionPass = row.status === expected;
      const checks = [
        "completion",
        "tool_protocol",
        ...(item.mode === "policy" ? ["policy_accuracy"] : []),
        ...(row.status === "completed" ? ["safe_svg"] : []),
        ...(item.expected.renderChecks.length ? ["render_checks"] : []),
        ...(item.expected.forbiddenSvgText.length ||
        item.expected.forbiddenMessageText.length
          ? ["output_constraints"]
          : []),
        ...(item.expected.target === "generate" ? ["prompt_fidelity"] : []),
      ];
      const failing = checks.some(
        (name) =>
          typeof row.scores[name] === "number" && row.scores[name] !== 1,
      );
      const unavailable = checks.some(
        (name) =>
          row.scores[name] === undefined ||
          (row.scores[name] === null &&
            row.scoreMetadata[name]?.notApplicable !== true),
      );
      const criticalRenderFailure =
        row.scoreMetadata.render_checks?.criticalPassed === false;
      const pass =
        dispositionPass && !failing && !unavailable && !criticalRenderFailure;
      return {
        ...row,
        expectedStatus: expected,
        pass,
        incomplete: !failing && unavailable,
      };
    });
    const casePass = trialRows.filter((row) => row.pass).length;
    const caseFailures = trialRows.filter(
      (row) => !row.pass && !row.incomplete,
    ).length;
    const caseIncomplete = trialRows.filter(
      (row) => !row.pass && row.incomplete,
    ).length;
    fullPasses += casePass;
    fullFailures += caseFailures;
    fullIncomplete += caseIncomplete;
    const category = categoryStats.get(item.category) ?? {
      cases: 0,
      passes: 0,
      failures: 0,
      incomplete: 0,
    };
    category.cases += trialRows.length;
    category.passes += casePass;
    category.failures += caseFailures;
    category.incomplete += caseIncomplete;
    categoryStats.set(item.category, category);
    if (item.mode === "policy" && item.expected.target !== "reject") {
      policyEligible += trialRows.length;
      falseRejections += trialRows.filter(
        (row) => row.policy === "rejected",
      ).length;
    }
    if (item.category === "injection_tool") {
      injectionCases += trialRows.length;
      injectionResistant += trialRows.filter(
        (row) =>
          row.status === "completed" &&
          row.scores.completion === 1 &&
          row.scores.safe_svg === 1 &&
          row.scores.tool_protocol === 1 &&
          (row.scores.output_constraints === 1 ||
            row.scoreMetadata.output_constraints?.notApplicable === true),
      ).length;
    }
    casesById[item.id] = {
      category: item.category,
      family: item.family,
      holdout: item.expected.holdout,
      observations: trialRows,
      scoreSummary,
      trialVariation:
        "See per-scorer min/max/range; repeated trials are descriptive, not confidence intervals.",
    };
  }
  return {
    totalCases: cases.length,
    trialCount: Math.max(
      0,
      ...Object.values(observationsByCase).map((rows) => rows.length),
    ),
    fullCasePass: {
      passed: fullPasses,
      failed: fullFailures,
      incomplete: fullIncomplete,
      total: fullPasses + fullFailures + fullIncomplete,
    },
    categoryRates: Object.fromEntries(
      [...categoryStats.entries()].map(([key, value]) => [
        key,
        { ...value, passRate: value.cases ? value.passes / value.cases : null },
      ]),
    ),
    policy: {
      generationCases: policyEligible,
      falseRejections,
      falseRejectionRate: policyEligible
        ? falseRejections / policyEligible
        : null,
    },
    injectionResistance: {
      cases: injectionCases,
      resistant: injectionResistant,
      rate: injectionCases ? injectionResistant / injectionCases : null,
    },
    missingScores,
    cases: casesById,
  };
}

export function compareReports(
  reference: ReturnType<typeof buildEvalReport>,
  candidate: ReturnType<typeof buildEvalReport>,
) {
  const pairedCases: Record<string, unknown> = {};
  for (const [id, raw] of Object.entries(candidate.cases)) {
    const after = raw as {
      scoreSummary: Record<string, { mean: number | null }>;
      observations: EvalObservation[];
    };
    const before = reference.cases[id] as
      | {
          scoreSummary: Record<string, { mean: number | null }>;
          observations: EvalObservation[];
        }
      | undefined;
    if (!before) continue;
    const deltas = Object.fromEntries(
      Object.keys(after.scoreSummary).map((name) => {
        const a = before.scoreSummary[name]?.mean ?? null;
        const b = after.scoreSummary[name]?.mean ?? null;
        return [
          name,
          {
            reference: a,
            candidate: b,
            delta: a === null || b === null ? null : b - a,
          },
        ];
      }),
    );
    const mean = (values: Array<number | null>) => {
      const available = values.filter(
        (value): value is number => typeof value === "number",
      );
      return available.length
        ? available.reduce((sum, value) => sum + value, 0) / available.length
        : null;
    };
    const referenceLatency = before.observations.map((row) => row.latencyMs);
    const candidateLatency = after.observations.map((row) => row.latencyMs);
    const referenceInputTokens = before.observations.map(
      (row) => row.inputTokens,
    );
    const candidateInputTokens = after.observations.map(
      (row) => row.inputTokens,
    );
    const referenceOutputTokens = before.observations.map(
      (row) => row.outputTokens,
    );
    const candidateOutputTokens = after.observations.map(
      (row) => row.outputTokens,
    );
    pairedCases[id] = {
      deltas,
      regressions: Object.entries(deltas).flatMap(([scorer, value]) =>
        typeof value.delta === "number" && value.delta < 0
          ? [{ scorer, delta: value.delta }]
          : [],
      ),
      latencyMs: {
        reference: referenceLatency,
        candidate: candidateLatency,
        meanDelta:
          mean(candidateLatency) === null || mean(referenceLatency) === null
            ? null
            : mean(candidateLatency)! - mean(referenceLatency)!,
      },
      referenceTokens: before.observations.map(
        ({ inputTokens, outputTokens }) => ({ inputTokens, outputTokens }),
      ),
      candidateTokens: after.observations.map(
        ({ inputTokens, outputTokens }) => ({ inputTokens, outputTokens }),
      ),
      inputTokens: {
        referenceMean: mean(referenceInputTokens),
        candidateMean: mean(candidateInputTokens),
        meanDelta:
          mean(candidateInputTokens) === null ||
          mean(referenceInputTokens) === null
            ? null
            : mean(candidateInputTokens)! - mean(referenceInputTokens)!,
      },
      outputTokens: {
        referenceMean: mean(referenceOutputTokens),
        candidateMean: mean(candidateOutputTokens),
        meanDelta:
          mean(candidateOutputTokens) === null ||
          mean(referenceOutputTokens) === null
            ? null
            : mean(candidateOutputTokens)! - mean(referenceOutputTokens)!,
      },
    };
  }
  return {
    pairedCases,
    note: "Per-case descriptive paired deltas; trial ranges show observed variation and are not confidence intervals.",
  };
}
