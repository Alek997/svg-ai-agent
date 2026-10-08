import assert from "node:assert/strict";
import { test } from "node:test";
import { recordFlowEvent, type FlowEntry } from "../lib/workspace/flow";
import type { GenerationEvent } from "../lib/workspace/contracts";

function record(events: GenerationEvent[]) {
  return events.reduce(recordFlowEvent, [] as FlowEntry[]);
}

test("timeline preserves arrival order when parallel tool results finish in reverse", () => {
  const flow = record([
    { type: "step", detail: { step: 1, status: "running", description: "Model started" } },
    { type: "tool", call: { id: "a", name: "querySvg", step: 1, status: "running", input: {} } },
    { type: "tool", call: { id: "b", name: "querySvg", step: 1, status: "running", input: {} } },
    { type: "tool", call: { id: "b", name: "querySvg", step: 1, status: "completed", output: { source: null, version: 0 } } },
    { type: "tool", call: { id: "a", name: "querySvg", step: 1, status: "completed", output: { source: null, version: 0 } } },
    { type: "step", detail: { step: 1, status: "completed", description: "Tools finished" } },
  ]);
  assert.deepEqual(flow.flatMap(entry => entry.kind === "tool" ? [`${entry.call.id}:${entry.call.status}`] : []), ["a:running", "b:running", "b:completed", "a:completed"]);
  assert.equal(flow[0].kind, "step");
  assert.equal(flow.at(-1)?.kind, "step");
});

test("public response updates coalesce without moving across intervening preview events", () => {
  const flow = record([
    { type: "response", step: 1, text: "A" },
    { type: "response", step: 1, text: "A circle" },
    { type: "preview", svg: { source: '<svg/>', width: 100, height: 100 } },
    { type: "response", step: 1, text: "A circle is ready" },
  ]);
  assert.deepEqual(flow.map(entry => entry.kind), ["response", "preview", "response"]);
  assert.deepEqual(flow[0], { kind: "response", step: 1, text: "A circle" });
});

test("timeline includes model-only steps and preserves errors after them", () => {
  const flow = record([
    { type: "step", detail: { step: 2, status: "running", description: "Model started" } },
    { type: "response", step: 2, text: "Revised the circle" },
    { type: "step", detail: { step: 2, status: "completed", description: "Model finished" } },
    { type: "error", message: "Invalid final SVG" },
  ]);
  assert.deepEqual(flow.map(entry => entry.kind), ["step", "response", "step", "error"]);
  assert.equal(flow.flatMap(entry => entry.kind === "tool" ? [entry] : []).length, 0);
});
