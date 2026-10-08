"use client";

import { useEffect, useRef, useState } from "react";
import { ChatPanel } from "./chat-panel";
import { SvgCanvas } from "./svg-canvas";
import { sampleDocument } from "@/lib/workspace/sample";
import {
  generationRequestSchema,
  type GenerationRequest,
} from "@/lib/workspace/contracts";
import { recordFlowEvent } from "@/lib/workspace/flow";
import { requestGeneration } from "@/lib/workspace/generate-client";
import { CLIENT_GENERATION_TIMEOUT_MS } from "@/lib/workspace/generation-limits";
import type { ChatMessage, SvgDocument } from "@/lib/workspace/types";

const welcome: ChatMessage = {
  id: "welcome",
  role: "assistant",
  content:
    "Describe an illustration, icon, or idea to create an SVG. After it’s ready, send a follow-up message to refine it.\n\nThe canvas starts with sample artwork for inspiration.",
};

export function SvgWorkspace() {
  const [messages, setMessages] = useState<ChatMessage[]>([welcome]);
  const [document, setDocument] = useState<SvgDocument | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [preview, setPreview] = useState<SvgDocument | null>(null);
  const [activity, setActivity] = useState("Starting generation…");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [conversation, setConversation] = useState(0);
  const activeRequest = useRef<AbortController | null>(null);
  const [retryInput, setRetryInput] = useState<GenerationRequest | null>(null);

  useEffect(() => () => activeRequest.current?.abort(), []);

  async function generate(input: GenerationRequest) {
    if (activeRequest.current) return;
    const controller = new AbortController();
    activeRequest.current = controller;
    const replyId = crypto.randomUUID();
    setMessages(previous => [...previous, { id: replyId, role: "assistant", content: "", flow: [], tools: [], steps: [], runStatus: "running" }]);
    setRetryInput(input);
    setIsLoading(true);
    setProgress(0);
    setPreview(null);
    setActivity("Starting generation…");
    setError(null);
    const timeout = setTimeout(() => controller.abort(), CLIENT_GENERATION_TIMEOUT_MS);
    try {
      await requestGeneration(input, controller.signal, (event) => {
        if (activeRequest.current !== controller) return;
        if (event.type !== "activity" && event.type !== "progress") {
          setMessages(previous => previous.map(message => message.id === replyId
            ? { ...message, flow: recordFlowEvent(message.flow ?? [], event) }
            : message));
        }
        if (event.type === "step") {
          setMessages(previous => previous.map(message => {
            if (message.id !== replyId) return message;
            const steps = [...(message.steps ?? [])];
            const index = steps.findIndex(detail => detail.step === event.detail.step);
            if (index === -1) steps.push(event.detail);
            else steps[index] = event.detail;
            return { ...message, steps };
          }));
        }
        if (event.type === "tool") {
          setMessages(previous => previous.map(message => {
            if (message.id !== replyId) return message;
            const tools = [...(message.tools ?? [])];
            const index = tools.findIndex(call => call.id === event.call.id);
            if (index === -1) tools.push(event.call);
            else tools[index] = { ...tools[index], ...event.call };
            return { ...message, tools };
          }));
        }
        if (event.type === "preview") setPreview({
          name: "draft.svg", description: "SVG in progress", ...event.svg,
        });
        if (event.type === "activity") setActivity(
          `Step ${event.step}/6 · ${event.action === "webSearch" ? "Searching for references…" : event.action === "querySvg" ? "Reading current SVG…" : event.action === "validateSvg" ? "Drawing and checking SVG…" : "Working…"}`,
        );
        if (event.type === "progress") setProgress(event.characters);
        if (event.type === "result") {
          setDocument(event.document);
          setPreview(null);
          setMessages(previous => previous.map(message => message.id === replyId
            ? { ...message, content: event.message, usage: event.usage, runStatus: "completed" }
            : message));
          setRetryInput(null);
        }
      });
    } catch (error) {
      if (activeRequest.current === controller) {
        const message = controller.signal.aborted
          ? "Generation timed out. Please retry."
          : error instanceof Error ? error.message : "Generation failed. Please retry.";
        setError(message);
        setMessages(previous => previous.map(reply => reply.id === replyId
          ? { ...reply, runStatus: "error", runError: message, flow: recordFlowEvent(reply.flow ?? [], { type: "error", message }) }
          : reply));
      }
    } finally {
      clearTimeout(timeout);
      if (activeRequest.current === controller) {
        activeRequest.current = null;
        setIsLoading(false);
        setPreview(null);
        setMessages(previous => previous.map(message => message.id === replyId ? {
          ...message,
          steps: message.steps?.map(detail => detail.status === "running"
            ? { ...detail, status: "interrupted" as const, description: "Generation ended before this step completed." }
            : detail),
          tools: message.tools?.map(call => call.status === "pending" || call.status === "running"
            ? { ...call, status: "error" as const, error: "Generation ended before this tool call completed." }
            : call),
        } : message).filter(message => message.id !== replyId || message.content || message.tools?.length || message.steps?.length || message.runStatus));
      }
    }
  }

  function sendMessage(content: string) {
    if (activeRequest.current) return;
    const nextMessages: ChatMessage[] = [
      ...messages,
      { id: crypto.randomUUID(), role: "user", content },
    ];
    const input = generationRequestSchema.safeParse({
      messages: nextMessages
        .filter((message) => message.id !== "welcome" && message.content.trim())
        .map(({ role, content }) => ({ role, content })),
      ...(document ? { currentSvg: document.source } : {}),
    });
    if (!input.success) {
      setError(
        "The conversation is too long or the message is invalid. Start a new conversation, or use a shorter message.",
      );
      return;
    }
    setMessages(nextMessages);
    void generate(input.data);
  }

  function resetConversation() {
    activeRequest.current?.abort();
    activeRequest.current = null;
    setRetryInput(null);
    setMessages([welcome]);
    setDocument(null);
    setPreview(null);
    setIsLoading(false);
    setError(null);
    setProgress(0);
    setConversation((value) => value + 1);
  }

  return (
    <div className="grid grid-cols-1 flex-1 lg:h-[calc(100dvh-76px)] lg:flex-none lg:grid-cols-[minmax(0,1fr)_380px] xl:grid-cols-[minmax(0,1fr)_400px]">
      <SvgCanvas
        document={preview ?? document ?? sampleDocument}
        hasPreview={!!preview}
        activity={activity}
        isSample={!document}
        isLoading={isLoading}
      />
      <ChatPanel
        key={conversation}
        messages={messages}
        onSend={sendMessage}
        onReset={resetConversation}
        isLoading={isLoading}
        progress={progress}
        activity={activity}
        error={error}
        onRetry={
          error && retryInput
            ? () => {
                void generate(retryInput);
              }
            : undefined
        }
      />
    </div>
  );
}
