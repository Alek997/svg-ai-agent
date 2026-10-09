import "server-only";
import { randomUUID } from "node:crypto";
import { initLogger, type Logger, type Span } from "braintrust";
import type { GenerationObserver } from "./handle-generation";
import type { GenerationRequest, ToolTrace } from "../workspace/contracts";
import { createFeedbackToken } from "./feedback-token";
import type { FeedbackRequest } from "../workspace/feedback";

let logger: Logger<true> | undefined;
let failedUploads = 0;

export function trackingEnabled() {
  return process.env.BRAINTRUST_TRACKING_ENABLED === "true" && !!process.env.BRAINTRUST_API_KEY?.trim();
}

export function getTrackingLogger() {
  if (!trackingEnabled()) return undefined;
  logger ??= initLogger({
    projectName: process.env.BRAINTRUST_PROJECT?.trim() || "svg-ai-agent",
    apiKey: process.env.BRAINTRUST_API_KEY,
    setCurrent: false,
    // No provider bodies, credentials, or raw SDK errors in application logs.
    onFlushError: () => { failedUploads++; console.warn("Braintrust upload failed."); },
  });
  return logger;
}

export async function saveTrackingFeedback(id: string, feedback: FeedbackRequest, userId: string) {
  const logger = getTrackingLogger();
  if (!logger) throw new Error("Tracking unavailable");
  const failuresBefore = failedUploads;
  logger.logFeedback({
    id,
    scores: { user_satisfaction: feedback.rating },
    comment: feedback.comment,
    metadata: { feedbackUserId: userId, feedbackReason: feedback.reason ?? null },
    source: "app",
  });
  // The SDK reports background upload failures through onFlushError, rather
  // than rejecting flush(). Check both so the UI doesn't falsely report success.
  await logger.flush();
  if (failedUploads !== failuresBefore) throw new Error("Feedback upload failed");
}

export async function flushTracking() {
  try { await logger?.flush(); }
  catch { console.warn("Braintrust upload failed."); }
}

export function startGenerationTracking(input: GenerationRequest, userId: string): GenerationObserver | undefined {
  try {
    const logger = getTrackingLogger();
    if (!logger) return undefined;
    return createGenerationObserver(logger.startSpan({ name: "svg-generation", type: "task" }), input, userId, process.env.BRAINTRUST_FEEDBACK_SECRET);
  } catch {
    console.warn("Braintrust tracking could not start.");
    return undefined;
  }
}

// Explicit application-level tracking avoids coupling this first version to
// provider telemetry. Only validated transport events and final artwork are logged.
export function createGenerationObserver(span: Pick<Span, "id" | "log" | "end">, input: GenerationRequest, userId: string, secret?: string): GenerationObserver {
  let ended = false;
  let status = "cancelled";
  const tools = new Map<string, ToolTrace>();
  const token = secret && secret.length >= 32 ? createFeedbackToken(span.id, userId, secret) : undefined;
  const safely = (action: () => void) => {
    try { action(); } catch { console.warn("Braintrust tracking update failed."); }
  };
  safely(() => span.log({
    input: { messages: input.messages, currentSvg: input.currentSvg ?? null },
    metadata: {
      userId,
      conversationId: input.conversationId ?? randomUUID(),
      turn: input.messages.filter(message => message.role === "user").length,
      environment: process.env.VERCEL_ENV || process.env.NODE_ENV || "development",
      trackingVersion: "v1",
      status: "running",
    },
  }));
  return {
    feedbackToken: () => token,
    event(event) {
      if (ended) return;
      safely(() => {
        if (event.type === "tool") {
          tools.set(event.call.id, { ...tools.get(event.call.id), ...event.call });
        }
        if (event.type === "result") {
          status = "completed";
          span.log({ output: { message: event.message, document: event.document }, metadata: { model: event.usage.model }, metrics: {
            ...(event.usage.inputTokens !== null ? { prompt_tokens: event.usage.inputTokens } : {}),
            ...(event.usage.outputTokens !== null ? { completion_tokens: event.usage.outputTokens } : {}),
            ...(event.usage.totalTokens !== null ? { tokens: event.usage.totalTokens } : {}),
          } });
        }
        if (event.type === "reply") {
          status = "completed";
          span.log({ output: { message: event.message }, metadata: { outcome: event.reason } });
        }
        if (event.type === "error") {
          status = "error";
          span.log({ error: event.message });
        }
      });
    },
    finish() {
      if (ended) return;
      ended = true;
      safely(() => span.log({ metadata: { status, tools: [...tools.values()] } }));
      safely(() => { span.end(); });
    },
  };
}
