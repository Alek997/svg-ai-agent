import "server-only";
import { handleGeneration, type GenerateSvg, type GenerationObserver } from "../ai/handle-generation";
import { checkGenerationPolicy, type PolicyOutcome } from "../ai/input-policy";
import { generationEventSchema, type GenerationEvent, type GenerationRequest } from "../workspace/contracts";
import { GENERATION_TIMEOUT_MS } from "../workspace/generation-limits";
import { applyEvent, finishDetails } from "./state";
import { submissionSchema } from "./contracts";
import { conversationStore, type StartedRun } from "./store";
import { readJson, conversationErrorResponse } from "./http";

type Store = Pick<typeof conversationStore, "begin" | "save">;
type Options = { store?: Store; checkPolicy?: (input: GenerationRequest, signal: AbortSignal) => Promise<PolicyOutcome>; observe?: (input: GenerationRequest) => GenerationObserver | undefined; timeoutMs?: number };
const streamHeaders = { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };

// Persistence surrounds the existing tested generation engine. Only server-built
// history crosses into it, and terminal success waits for the database commit.
export async function handleSavedGeneration(request: Request, userId: string, generate: GenerateSvg, options: Options = {}) {
  const store = options.store ?? conversationStore;
  let run: StartedRun;
  try { run = await store.begin(userId, await readJson(request, submissionSchema)); }
  catch (error) { return conversationErrorResponse(error); }
  const started: GenerationEvent = { type: "started", conversationId: run.conversationId, userMessageId: run.userMessageId, assistantMessageId: run.assistantMessageId, revision: run.revision, replayed: run.replayed };
  if (run.replayed) {
    const terminal: GenerationEvent = run.message.runStatus === "completed"
      ? run.message.usage && run.document
        ? { type: "result", message: run.message.content, document: run.document, usage: run.message.usage, ...(run.message.feedbackToken ? { feedbackToken: run.message.feedbackToken } : {}) }
        : { type: "reply", reason: "conversation", message: run.message.content }
      : { type: "error", message: run.message.runError ?? "This generation is still running. Reopen the conversation to check its status.", retryable: run.message.runStatus !== "running" && (run.message.retryable ?? true), interrupted: run.message.runStatus === "interrupted" };
    return new Response([started, terminal].map(event => JSON.stringify(event) + "\n").join(""), { headers: streamHeaders });
  }
  const cancellation = new AbortController();
  const signal = AbortSignal.any([request.signal, cancellation.signal]);
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  let closed = false;
  let terminalSaved = false;
  let message = run.message;
  let lastSave = Date.now();
  let failureToSave = false;
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: GenerationEvent) => {
        if (!closed && !signal.aborted) controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
      };
      async function persistError(event: Extract<GenerationEvent, { type: "error" }>) {
        if (terminalSaved) return;
        message = finishDetails(applyEvent(message, event));
        await store.save(userId, run, message, true, undefined, event.excludedFromContext);
        terminalSaved = true;
      }
      try {
        send(started);
        signal.throwIfAborted();
        const input = new Request(request.url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(run.input), signal });
        const response = await handleGeneration(input, generate, options.timeoutMs ?? GENERATION_TIMEOUT_MS, options.checkPolicy ?? checkGenerationPolicy, options.observe);
        if (!response.ok) {
          const body = await response.json();
          const event: GenerationEvent = { type: "error", message: body.error, excludedFromContext: response.status === 422, retryable: response.status !== 422 };
          await persistError(event);
          send(event);
          return;
        }
        reader = response.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        async function consume(line: string) {
          if (!line.trim()) return;
          signal.throwIfAborted();
          const event = generationEventSchema.parse(JSON.parse(line));
          message = applyEvent(message, event);
          const terminal = event.type === "reply" || event.type === "result" || event.type === "error";
          if (terminal) {
            message = finishDetails(message);
            await store.save(userId, run, message, true, event.type === "result" ? event.document : undefined);
            terminalSaved = true;
          } else if (Date.now() - lastSave >= 1000) {
            await store.save(userId, run, message, false);
            lastSave = Date.now();
          }
          send(event);
        }
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let newline: number;
          while ((newline = buffer.indexOf("\n")) !== -1) { await consume(buffer.slice(0, newline)); buffer = buffer.slice(newline + 1); }
        }
        buffer += decoder.decode();
        await consume(buffer);
        if (!terminalSaved) throw new Error("Generation interrupted");
      } catch {
        const event: GenerationEvent = { type: "error", message: signal.aborted ? "Generation was interrupted. Please retry." : "Generation or saving failed. Reopen the conversation to check what was saved.", interrupted: signal.aborted, retryable: true };
        // A failed final commit cannot leave an in-memory result in a checkpoint.
        if (!terminalSaved) {
          message = { ...message, content: "", usage: undefined, feedbackToken: undefined, feedbackExpiresAt: undefined, flow: message.flow?.filter(entry => entry.kind !== "result") };
          try { await persistError(event); } catch { failureToSave = true; }
          send(failureToSave ? { ...event, message: "Saving failed. Reopen the conversation before retrying; its unfinished run will be recovered automatically." } : event);
        }
      } finally {
        cancellation.abort();
        await reader?.cancel().catch(() => {});
        reader?.releaseLock();
        if (!closed) { closed = true; controller.close(); }
      }
    },
    async cancel() { closed = true; cancellation.abort(); await reader?.cancel().catch(() => {}); },
  });
  return new Response(stream, { headers: streamHeaders });
}
