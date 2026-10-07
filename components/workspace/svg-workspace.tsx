"use client";

import { useEffect, useRef, useState } from "react";
import { ChatPanel } from "./chat-panel";
import { SvgCanvas } from "./svg-canvas";
import { sampleDocument } from "@/lib/workspace/sample";
import {
  generationRequestSchema,
  type GenerationRequest,
} from "@/lib/workspace/contracts";
import { requestGeneration } from "@/lib/workspace/generate-client";
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
    setRetryInput(input);
    setIsLoading(true);
    setProgress(0);
    setError(null);
    const timeout = setTimeout(() => controller.abort(), 70_000);
    try {
      await requestGeneration(input, controller.signal, (event) => {
        if (activeRequest.current !== controller) return;
        if (event.type === "progress") setProgress(event.characters);
        if (event.type === "result") {
          setDocument(event.document);
          setMessages((previous) => [
            ...previous,
            {
              id: crypto.randomUUID(),
              role: "assistant",
              content: event.message,
              usage: event.usage,
            },
          ]);
          setRetryInput(null);
        }
      });
    } catch (error) {
      if (activeRequest.current === controller) {
        setError(
          controller.signal.aborted
            ? "Generation timed out. Please retry."
            : error instanceof Error
              ? error.message
              : "Generation failed. Please retry.",
        );
      }
    } finally {
      clearTimeout(timeout);
      if (activeRequest.current === controller) {
        activeRequest.current = null;
        setIsLoading(false);
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
        .filter((message) => message.id !== "welcome")
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
    setIsLoading(false);
    setError(null);
    setProgress(0);
    setConversation((value) => value + 1);
  }

  return (
    <div className="grid grid-cols-1 flex-1 lg:h-[calc(100dvh-76px)] lg:flex-none lg:grid-cols-[minmax(0,1fr)_380px] xl:grid-cols-[minmax(0,1fr)_400px]">
      <SvgCanvas
        document={document ?? sampleDocument}
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
