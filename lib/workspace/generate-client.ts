import {
  generationEventSchema,
  MAX_RESPONSE_BYTES,
  type GenerationEvent,
  type GenerationRequest,
} from "./contracts";

export class GenerationRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export async function requestGeneration(
  input: GenerationRequest | import("../conversations/contracts").Submission,
  signal: AbortSignal,
  onEvent: (event: GenerationEvent) => void,
) {
  const response = await fetch("/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
    signal,
  });
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    const message =
      body &&
      typeof body === "object" &&
      "error" in body &&
      typeof body.error === "string"
        ? body.error
        : "Unable to start generation.";
    throw new GenerationRequestError(message, response.status);
  }
  if (
    !response.body ||
    !response.headers.get("content-type")?.includes("application/x-ndjson")
  ) {
    throw new Error("The server returned an unexpected response.");
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let bytes = 0;
  let completed = false;
  function consumeLine(line: string) {
    if (!line.trim()) return;
    if (completed)
      throw new Error("Unexpected data after generation finished.");
    const event = generationEventSchema.parse(JSON.parse(line));
    if (event.type === "error") {
      onEvent(event);
      throw new Error(event.message);
    }
    if (event.type === "result" || event.type === "reply") completed = true;
    onEvent(event);
  }
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES)
        throw new Error("The server response exceeded its size limit.");
      buffer += decoder.decode(value, { stream: true });
      let newline: number;
      while ((newline = buffer.indexOf("\n")) !== -1) {
        consumeLine(buffer.slice(0, newline));
        buffer = buffer.slice(newline + 1);
      }
    }
    buffer += decoder.decode();
    consumeLine(buffer);
    if (!completed)
      throw new Error(
        "Generation ended before the SVG was ready. Please retry.",
      );
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
