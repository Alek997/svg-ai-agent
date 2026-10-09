"use client";

import { useEffect, useRef, useState } from "react";
import { ChatPanel } from "./chat-panel";
import { Button } from "@/components/ui/button";
import { SvgCanvas } from "./svg-canvas";
import { sampleDocument } from "@/lib/workspace/sample";
import {
  generationRequestSchema,
  type GenerationRequest,
} from "@/lib/workspace/contracts";
import { recordFlowEvent } from "@/lib/workspace/flow";
import { GenerationRequestError, requestGeneration } from "@/lib/workspace/generate-client";
import { CLIENT_GENERATION_TIMEOUT_MS } from "@/lib/workspace/generation-limits";
import type { ChatMessage, SvgDocument } from "@/lib/workspace/types";

const welcome: ChatMessage = {
  id: "welcome",
  role: "assistant",
  content:
    "Describe an illustration, icon, or idea to create an SVG. After it’s ready, send a follow-up message to refine it.\n\nThe canvas starts with sample artwork for inspiration.",
};

export function SvgWorkspace({ trackingEnabled = false }: { trackingEnabled?: boolean }) {
  const [messages, setMessages] = useState<ChatMessage[]>([welcome]);
  const [document, setDocument] = useState<SvgDocument | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [preview, setPreview] = useState<SvgDocument | null>(null);
  const [activity, setActivity] = useState("Starting generation…");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [conversation, setConversation] = useState(0);
  const [draft, setDraft] = useState("");
  const resetDialog = useRef<HTMLDialogElement>(null);
  const keepWorking = useRef<HTMLButtonElement>(null);
  const activeRequest = useRef<AbortController | null>(null);
  const conversationId = useRef<string | null>(null);
  const [retryInput, setRetryInput] = useState<GenerationRequest | null>(null);
  const retryAvailableAt = useRef(0);
  const [retrySeconds, setRetrySeconds] = useState(0);
  const isRetryCoolingDown = retrySeconds > 0;

  useEffect(() => () => activeRequest.current?.abort(), []);
  useEffect(() => {
    if (!isRetryCoolingDown) return;
    const interval = setInterval(() => {
      setRetrySeconds(Math.max(0, Math.ceil((retryAvailableAt.current - Date.now()) / 1000)));
    }, 250);
    return () => clearInterval(interval);
  }, [isRetryCoolingDown]);

  const hasWork = messages.length > 1 || !!document || !!draft.trim() || isLoading;
  useEffect(() => {
    if (!hasWork) return;
    function warnBeforeLeaving(event: BeforeUnloadEvent) {
      event.preventDefault();
      // Browsers display their own warning, not application-provided text.
      event.returnValue = true;
    }
    window.addEventListener("beforeunload", warnBeforeLeaving);
    return () => window.removeEventListener("beforeunload", warnBeforeLeaving);
  }, [hasWork]);

  function requestNewIcon() {
    if (!hasWork) {
      resetConversation();
      return;
    }
    resetDialog.current?.showModal();
    keepWorking.current?.focus();
  }

  async function generate(input: GenerationRequest) {
    if (activeRequest.current) return;
    const controller = new AbortController();
    activeRequest.current = controller;
    const replyId = crypto.randomUUID();
    setMessages(previous => [...previous, { id: replyId, role: "assistant", content: "", flow: [], tools: [], steps: [], runStatus: "running" }]);
    setRetryInput(input);
    retryAvailableAt.current = 0;
    setRetrySeconds(0);
    setIsLoading(true);
    setIsGenerating(false);
    setProgress(0);
    setPreview(null);
    setActivity("Checking your request…");
    setError(null);
    const timeout = setTimeout(() => controller.abort(), CLIENT_GENERATION_TIMEOUT_MS);
    try {
      await requestGeneration(input, controller.signal, (event) => {
        if (activeRequest.current !== controller) return;
        if (event.type !== "activity" && event.type !== "progress" && event.type !== "reply") {
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
        if (event.type === "progress") {
          setIsGenerating(true);
          setProgress(event.characters);
          setActivity(previous => previous === "Checking your request…" ? "Starting generation…" : previous);
        }
        if (event.type === "reply") {
          setMessages(previous => previous.map(message => message.id === replyId
            ? { ...message, content: event.message, runStatus: "completed" }
            : message));
          setRetryInput(null);
        }
        if (event.type === "result") {
          setDocument(event.document);
          setPreview(null);
          setMessages(previous => previous.map(message => message.id === replyId
            ? { ...message, content: event.message, usage: event.usage, feedbackToken: event.feedbackToken, runStatus: "completed" }
            : message));
          setRetryInput(null);
        }
      });
    } catch (error) {
      if (activeRequest.current === controller) {
        if (error instanceof GenerationRequestError && error.status === 422) {
          setRetryInput(null);
          // Keep the rejected prompt visible, but don't resubmit it on the next
          // safe turn. This is UI recovery, not a server trust mechanism.
          setMessages(previous => {
            const lastUserId = previous.findLast(message => message.role === "user")?.id;
            return previous.map(message => message.id === lastUserId
              ? { ...message, excludedFromContext: true } : message);
          });
        } else {
          retryAvailableAt.current = Date.now() + 15_000;
          setRetrySeconds(15);
        }
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
        setIsGenerating(false);
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
      conversationId: conversationId.current ??= crypto.randomUUID(),
      messages: nextMessages
        .filter((message) => message.id !== "welcome" && !message.excludedFromContext && message.content.trim())
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
    resetDialog.current?.close();
    activeRequest.current?.abort();
    activeRequest.current = null;
    conversationId.current = null;
    setRetryInput(null);
    retryAvailableAt.current = 0;
    setRetrySeconds(0);
    setMessages([welcome]);
    setDraft("");
    setDocument(null);
    setPreview(null);
    setIsLoading(false);
    setIsGenerating(false);
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
        isLoading={isGenerating}
      />
      <ChatPanel
        key={conversation}
        messages={messages}
        onSend={sendMessage}
        onReset={requestNewIcon}
        draft={draft}
        onDraftChange={setDraft}
        isLoading={isLoading}
        progress={progress}
        activity={activity}
        trackingEnabled={trackingEnabled}
        error={error}
        retrySeconds={retrySeconds}
        onRetry={
          error && retryInput
            ? () => {
                if (Date.now() < retryAvailableAt.current) return;
                void generate(retryInput);
              }
            : undefined
        }
      />
      <dialog
        ref={resetDialog}
        aria-labelledby="reset-title"
        aria-describedby="reset-description"
        className="fixed inset-0 m-auto w-[calc(100%-2rem)] max-w-md rounded-2xl border border-stone-200 bg-white p-6 text-stone-800 shadow-xl backdrop:bg-stone-900/40"
      >
        <h2 id="reset-title" className="text-lg font-semibold">Start a new icon?</h2>
        <div id="reset-description" className="mt-3 space-y-3 text-sm leading-6 text-stone-600">
          <p>This will remove your current conversation, artwork, and any unsent message from this workspace. This cannot be undone.</p>
          {isLoading && <p>Generation is still running and will be canceled.</p>}
          {document && <p>To keep your icon, choose Keep working and download your SVG first.</p>}
        </div>
        <div className="mt-6 flex flex-wrap justify-end gap-3">
          <button
            ref={keepWorking}
            type="button"
            onClick={() => resetDialog.current?.close()}
            className="rounded-lg border border-stone-200 px-3 py-2 text-xs font-medium hover:bg-stone-50"
          >Keep working</button>
          <Button onClick={resetConversation} variant="destructive">Discard and start new</Button>
        </div>
      </dialog>
    </div>
  );
}
