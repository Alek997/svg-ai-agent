import { z } from "zod";
import { ModelConfigurationError } from "./errors";
import {
  generationRequestSchema,
  generationEventSchema,
  generationUsageSchema,
  MAX_REQUEST_BYTES,
  MAX_RESPONSE_BYTES,
  type GenerationRequest,
  type GenerationEvent,
  type GenerationUsage,
} from "../workspace/contracts";
import { safeSvgSchema } from "../svg/validate-svg";
import { GENERATION_TIMEOUT_MS } from "../workspace/generation-limits";
import {
  checkGenerationPolicy,
  InputPolicyError,
  type PolicyOutcome,
} from "./input-policy";

const resultSchema = z
  .object({
    message: z.string().trim().min(1).max(2000),
    filename: z.string().regex(/^[a-z0-9][a-z0-9-]{0,59}\.svg$/),
    svg: safeSvgSchema,
  })
  .strict();

export type ServerSvgGenerator = (
  svgGenerationRequest: GenerationRequest,
  signal: AbortSignal,
  onProgress: (characters: number) => void,
  onEvent?: (event: GenerationEvent) => void,
) => Promise<{ output: unknown; usage: GenerationUsage }>;

export type GenerationObserver = {
  event: (event: GenerationEvent) => void;
  feedbackToken: () => string | undefined;
  finish: () => void;
};

class RequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function readSvgGenerationRequest(request: Request) {
  if (
    request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !==
    "application/json"
  ) {
    throw new RequestError("Send a JSON request.", 415);
  }
  if (Number(request.headers.get("content-length")) > MAX_REQUEST_BYTES) {
    throw new RequestError("Request is too large.", 413);
  }
  const reader = request.body?.getReader();
  if (!reader) throw new RequestError("Request body is required.", 400);
  const decoder = new TextDecoder();
  let text = "";
  let bytes = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_REQUEST_BYTES) {
        await reader.cancel();
        throw new RequestError("Request is too large.", 413);
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } finally {
    reader.releaseLock();
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new RequestError("Request must contain valid JSON.", 400);
  }
  const parsed = generationRequestSchema.safeParse(json);
  if (!parsed.success)
    throw new RequestError(
      "Invalid conversation. Send up to 20 user/assistant messages, each 1–2000 characters, ending with a user message. Start a new conversation if it is too long.",
      400,
    );
  if (parsed.data.currentSvg) {
    const svg = safeSvgSchema.safeParse(parsed.data.currentSvg);
    if (!svg.success)
      throw new RequestError(
        "Current artwork is not a supported safe SVG.",
        400,
      );
    parsed.data.currentSvg = svg.data.source;
  }
  return parsed.data;
}

export async function handleSvgGenerationOnServer({
  request,
  generateSvgOnServer,
  timeoutMs = GENERATION_TIMEOUT_MS,
  checkGenerationPolicy: evaluateGenerationPolicy = checkGenerationPolicy,
  startGenerationTracking,
}: {
  request: Request;
  generateSvgOnServer: ServerSvgGenerator;
  timeoutMs?: number;
  checkGenerationPolicy?: (
    svgGenerationRequest: GenerationRequest,
    signal: AbortSignal,
  ) => Promise<PolicyOutcome>;
  startGenerationTracking?: (
    svgGenerationRequest: GenerationRequest,
  ) => GenerationObserver | undefined;
}) {
  let svgGenerationRequest: GenerationRequest;
  try {
    svgGenerationRequest = await readSvgGenerationRequest(request);
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof RequestError
            ? error.message
            : "Unable to read request.",
      },
      { status: error instanceof RequestError ? error.status : 400 },
    );
  }
  const observer = startGenerationTracking?.(svgGenerationRequest);
  const cancellation = new AbortController();
  const timeout = setTimeout(() => cancellation.abort(), timeoutMs);
  const signal = AbortSignal.any([request.signal, cancellation.signal]);
  // Gate before starting the stream: denied requests cannot run tools or emit drafts.
  // The same overall deadline includes policy checks and generation.
  try {
    const outcome = await evaluateGenerationPolicy(
      svgGenerationRequest,
      signal,
    );
    signal.throwIfAborted();
    if (outcome.kind === "reply") {
      const event = generationEventSchema.parse({
        type: "reply",
        reason: outcome.reason,
        message: outcome.message,
      });
      observer?.event(event);
      observer?.finish();
      clearTimeout(timeout);
      cancellation.abort();
      // A terminal text reply uses the same transport, with no generation,
      // previews, document, usage claims or feedback permission.
      return new Response(`${JSON.stringify(event)}\n`, {
        headers: {
          "Content-Type": "application/x-ndjson; charset=utf-8",
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        },
      });
    }
  } catch (error) {
    clearTimeout(timeout);
    cancellation.abort();
    observer?.event({
      type: "error",
      message:
        error instanceof InputPolicyError
          ? error.message
          : "Input policy check unavailable.",
    });
    observer?.finish();
    return Response.json(
      {
        error:
          error instanceof InputPolicyError
            ? error.message
            : "Unable to check this request right now. Please try again shortly.",
      },
      {
        status: error instanceof InputPolicyError ? error.status : 503,
        headers: { "Cache-Control": "no-store" },
      },
    );
  }
  const encoder = new TextEncoder();
  let closed = false;
  let responseBytes = 0;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emitGenerationEvent = (event: GenerationEvent) => {
        observer?.event(event);
        if (!closed && !request.signal.aborted) {
          const chunk = encoder.encode(`${JSON.stringify(event)}\n`);
          // Snapshots are expendable; reserve room for the final SVG and errors.
          if (
            event.type === "preview" &&
            responseBytes + chunk.byteLength > MAX_RESPONSE_BYTES - 320_000
          )
            return;
          if (responseBytes + chunk.byteLength > MAX_RESPONSE_BYTES) {
            throw new Error("Response limit exceeded");
          }
          responseBytes += chunk.byteLength;
          controller.enqueue(chunk);
        }
      };
      try {
        emitGenerationEvent({ type: "progress", characters: 0 });
        const raw = await generateSvgOnServer(
          svgGenerationRequest,
          signal,
          (characters) => emitGenerationEvent({ type: "progress", characters }),
          (event) => {
            if (event.type === "preview") {
              emitGenerationEvent({
                type: "preview",
                svg: safeSvgSchema.parse(event.svg.source),
              });
            } else if (
              event.type === "retrieval" ||
              event.type === "activity" ||
              event.type === "tool" ||
              event.type === "step" ||
              event.type === "response"
            )
              emitGenerationEvent(generationEventSchema.parse(event));
          },
        );
        if (signal.aborted) throw new Error("Aborted");
        const result = resultSchema.safeParse(raw.output);
        if (!result.success) {
          emitGenerationEvent({
            type: "error",
            message:
              "The model returned invalid or unsafe SVG. Try a simpler description.",
          });
        } else {
          const changed =
            result.data.svg.source !== svgGenerationRequest.currentSvg;
          const feedbackToken = changed ? observer?.feedbackToken() : undefined;
          emitGenerationEvent({
            type: "result",
            message: result.data.message,
            usage: generationUsageSchema.parse(raw.usage),
            ...(feedbackToken ? { feedbackToken } : {}),
            document: {
              name: result.data.filename,
              description: result.data.message.slice(0, 1000),
              ...result.data.svg,
            },
          });
        }
      } catch (error) {
        emitGenerationEvent({
          type: "error",
          message:
            error instanceof ModelConfigurationError
              ? error.message
              : signal.aborted
                ? "Generation timed out or was cancelled. Please try again."
                : "Generation failed. Check server configuration and API availability, then try again.",
        });
      } finally {
        observer?.finish();
        cancellation.abort();
        clearTimeout(timeout);
        if (!closed) {
          closed = true;
          controller.close();
        }
      }
    },
    cancel() {
      observer?.finish();
      closed = true;
      cancellation.abort();
      clearTimeout(timeout);
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
