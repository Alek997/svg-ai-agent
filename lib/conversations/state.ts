import type { ChatMessage } from "../workspace/types";
import type { GenerationEvent, GenerationRequest, StepTrace, ToolTrace } from "../workspace/contracts";
import { generationRequestSchema } from "../workspace/contracts";
import { recordFlowEvent, type FlowEntry } from "../workspace/flow";

// Select a contiguous suffix of complete turns, never an orphan assistant reply.
export function selectContext(messages: Pick<ChatMessage, "role" | "content" | "excludedFromContext" | "runStatus">[], latest: string): GenerationRequest["messages"] {
  const turns: GenerationRequest["messages"][] = [];
  for (const message of messages) {
    if (message.excludedFromContext || !message.content.trim()) continue;
    if (message.role === "user") turns.push([{ role: "user", content: message.content }]);
    else if (message.runStatus === "completed" && turns.length) turns.at(-1)!.push({ role: "assistant", content: message.content });
  }
  let context: GenerationRequest["messages"] = [{ role: "user", content: latest }];
  for (const turn of turns.reverse()) {
    const candidate = [...turn, ...context];
    if (!generationRequestSchema.safeParse({ messages: candidate }).success) break;
    context = candidate;
  }
  return context;
}

export function applyEvent(message: ChatMessage, event: GenerationEvent): ChatMessage {
  const next = { ...message, flow: recordFlowEvent(message.flow ?? [], event) };
  if (event.type === "step") next.steps = [...(message.steps ?? []).filter(step => step.step !== event.detail.step), event.detail].sort((a, b) => a.step - b.step);
  if (event.type === "tool") {
    const tools = [...(message.tools ?? [])];
    const index = tools.findIndex(tool => tool.id === event.call.id);
    if (index === -1) tools.push(event.call);
    else tools[index] = { ...tools[index], ...event.call };
    next.tools = tools;
  }
  if (event.type === "reply" || event.type === "result") {
    next.content = event.message;
    next.runStatus = "completed";
  }
  if (event.type === "result") {
    next.usage = event.usage;
    next.feedbackToken = event.feedbackToken;
    if (event.feedbackToken) next.feedbackExpiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000;
  }
  if (event.type === "error") {
    next.runStatus = event.interrupted ? "interrupted" : "error";
    next.runError = event.message;
    next.retryable = event.retryable ?? true;
  }
  return next;
}

export function finishDetails(message: ChatMessage): ChatMessage {
  return { ...message,
    steps: message.steps?.map(step => step.status === "running" ? { ...step, status: "interrupted", description: "Generation ended before this step completed." } : step),
    tools: message.tools?.map(tool => tool.status === "pending" || tool.status === "running" ? { ...tool, status: "error", error: "Generation ended before this tool call completed." } : tool),
  };
}

export function groupedDetails(flow: FlowEntry[]) {
  const steps = new Map<number, StepTrace>();
  const tools = new Map<string, ToolTrace>();
  for (const entry of flow) {
    if (entry.kind === "step") steps.set(entry.detail.step, entry.detail);
    if (entry.kind === "tool") tools.set(entry.call.id, { ...tools.get(entry.call.id), ...entry.call });
  }
  return { steps: [...steps.values()], tools: [...tools.values()] };
}
