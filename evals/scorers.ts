import { safeSvgSchema } from "../lib/svg/validate-svg";
import { MAX_AGENT_STEPS } from "../lib/ai/svg-agent";
import type { Scorer } from "./types";

export const completionScorer: Scorer = {
  name: "completion",
  run: (_, output) => ({ name: "completion", score: output.status === "completed" ? 1 : 0 }),
};

export const safeSvgScorer: Scorer = {
  name: "safe_svg",
  run: (_, output) => ({ name: "safe_svg", score: output.source && safeSvgSchema.safeParse(output.source).success ? 1 : 0 }),
};

export const toolProtocolScorer: Scorer = {
  name: "tool_protocol",
  run: (item, output) => {
    const tools = output.events.flatMap(event => event.type === "tool" ? [event.call] : []);
    const lastValidation = tools.filter(call => call.name === "validateSvg").at(-1);
    const queryIndex = tools.findIndex(call => call.name === "querySvg" && call.status === "completed");
    const proposalIndex = tools.findIndex(call => call.name === "validateSvg" && call.status === "running");
    const checks = {
      completed: output.status === "completed",
      withinStepLimit: output.metrics.steps > 0 && output.metrics.steps <= MAX_AGENT_STEPS,
      finalProposalValidated: lastValidation?.status === "completed" && lastValidation.output && "valid" in lastValidation.output && lastValidation.output.valid === true,
      readBeforeEditing: !item.input.currentSvg || (queryIndex >= 0 && proposalIndex > queryIndex),
    };
    return { name: "tool_protocol", score: Object.values(checks).every(Boolean) ? 1 : 0, metadata: { checks } };
  },
};

// Add/remove scorers here. No runner or Braintrust changes are needed.
export const basicScorers: Scorer[] = [completionScorer, safeSvgScorer, toolProtocolScorer];
