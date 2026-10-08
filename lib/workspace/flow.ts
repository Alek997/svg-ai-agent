import type { GenerationEvent, StepTrace, ToolTrace } from "./contracts";
import type { SvgDocument } from "./types";

export type FlowEntry =
  | { kind: "step"; detail: StepTrace }
  | { kind: "tool"; call: ToolTrace }
  | { kind: "response"; step: number; text: string }
  | { kind: "preview"; characters: number; width: number; height: number }
  | { kind: "result"; message: string; document: SvgDocument }
  | { kind: "error"; message: string };

// Append arrival order, including parallel tools' out-of-order results. Only
// consecutive public text updates are coalesced; no tool or step is moved.
export function recordFlowEvent(flow: FlowEntry[], event: GenerationEvent): FlowEntry[] {
  switch (event.type) {
    case "step": return [...flow, { kind: "step", detail: event.detail }];
    case "tool": return [...flow, { kind: "tool", call: event.call }];
    case "response": {
      const last = flow.at(-1);
      const entry: FlowEntry = { kind: "response", step: event.step, text: event.text };
      return last?.kind === "response" && last.step === event.step
        ? [...flow.slice(0, -1), entry]
        : [...flow, entry];
    }
    case "preview": return [...flow, { kind: "preview", characters: event.svg.source.length, width: event.svg.width, height: event.svg.height }];
    case "result": return [...flow, { kind: "result", message: event.message, document: event.document }];
    case "error": return [...flow, { kind: "error", message: event.message }];
    default: return flow;
  }
}
