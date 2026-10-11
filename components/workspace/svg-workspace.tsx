"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { WorkspaceCollections } from "../collections/workspace-collections";
import { ChatPanel } from "./chat-panel";
import { Button } from "@/components/ui/button";
import { SvgCanvas } from "./svg-canvas";
import { EmptySavedCanvas, WorkspaceSkeleton } from "./workspace-loading";
import { sampleDocument } from "@/lib/workspace/sample";
import { submissionSchema, type Submission, type ConversationPage, RUN_LEASE_MS } from "@/lib/conversations/contracts";
import { createConversation, loadConversation } from "@/lib/conversations/client";
import { applyEvent, finishDetails } from "@/lib/conversations/state";
import { GenerationRequestError, requestGeneration } from "@/lib/workspace/generate-client";
import { CLIENT_GENERATION_TIMEOUT_MS } from "@/lib/workspace/generation-limits";
import type { ChatMessage, SvgDocument } from "@/lib/workspace/types";

const welcome: ChatMessage = { id: "welcome", role: "assistant", content: "Describe an illustration, icon, or idea to create an SVG. After it’s ready, send a follow-up message to refine it.\n\nThe canvas starts with sample artwork for inspiration." };
export function SvgWorkspace({ trackingEnabled = false, initialConversationId, ragEnabled = false }: { ragEnabled?: boolean; trackingEnabled?: boolean; initialConversationId?: string }) {
  const pathname = usePathname();
  const [collectionId, setCollectionId] = useState("");
  const [privateConversation, setPrivateConversation] = useState(false);
  const routeId = pathname.startsWith("/conversations/") ? pathname.split("/")[2] : null;
  const [messages, setMessages] = useState<ChatMessage[]>(initialConversationId ? [] : [welcome]);
  const [document, setDocument] = useState<SvgDocument | null>(null);
  const [publicId, setPublicId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [opening, setOpening] = useState(!!initialConversationId);
  const [displayedId, setDisplayedId] = useState<string | null>(null);
  const [ready, setReady] = useState(!initialConversationId);
  const [activeSavedRun, setActiveSavedRun] = useState<string | null>(null);
  const [leaseExpiresAt, setLeaseExpiresAt] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [preview, setPreview] = useState<SvgDocument | null>(null);
  const [activity, setActivity] = useState("Starting generation…");
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [olderCursor, setOlderCursor] = useState<number | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [historyRefresh, setHistoryRefresh] = useState(0);
  const [retryInput, setRetryInput] = useState<Submission | null>(null);
  const [retrySeconds, setRetrySeconds] = useState(0);
  const [loadVersion, setLoadVersion] = useState(0);
  const retryAvailableAt = useRef(0);
  const conversationId = useRef<string | null>(null);
  const revision = useRef(0);
  const loadedVersion = useRef(0);
  const activeRequest = useRef<AbortController | null>(null);
  const pendingCreation = useRef<{ id: string; content: string } | null>(null);
  const resetDialog = useRef<HTMLDialogElement>(null);
  const keepWorking = useRef<HTMLButtonElement>(null);
  const pendingNavigation = useRef<string>("/");

  function restore(page: ConversationPage, merge = false) {
    conversationId.current = page.conversation.id;
    setDisplayedId(page.conversation.id);
    revision.current = page.conversation.revision;
    setCollectionId(page.conversation.collectionId ?? ""); setPrivateConversation(page.conversation.private ?? false);
    setMessages(previous => merge ? [...previous.filter(message => message.id !== "welcome" && message.position && !page.messages.some(saved => saved.id === message.id)), ...page.messages].sort((a, b) => (a.position ?? 0) - (b.position ?? 0)) : page.messages);
    setDocument(page.document); setPublicId(page.publicId); setPreview(null); setActiveSavedRun(page.conversation.activeRunId); setLeaseExpiresAt(page.conversation.leaseExpiresAt);
    if (!merge) setOlderCursor(page.olderCursor);
    setReady(true);
    const last = page.messages.at(-1);
    if (last && ["error", "interrupted"].includes(last.runStatus) && last.retryable) {
      setRetryInput({ kind: "retry", conversationId: page.conversation.id, retryOf: last.id, requestId: crypto.randomUUID(), expectedRevision: page.conversation.revision });
      setError(last.runError ?? "Generation was interrupted. Please retry.");
    } else { setRetryInput(null); setError(null); }
  }

  useEffect(() => {
    // A failed open leaves the saved ID null; returning home must still reset the workspace.
    if (routeId && routeId === conversationId.current && loadVersion === loadedVersion.current) return;
    loadedVersion.current = loadVersion;
    const controller = new AbortController();
    // Async loading also makes effect cleanup safe during development Strict Mode.
    void Promise.resolve().then(async () => {
      if (controller.signal.aborted) return;
      activeRequest.current?.abort(); activeRequest.current = null;
      setIsLoading(false); setIsGenerating(false); setProgress(0); setActivity("Starting generation…");
      setPreview(null); setReady(false); setError(null); setRetryInput(null); setRetrySeconds(0);
      if (routeId !== conversationId.current) {
        setDraft(""); setMessages([]); setDocument(null); setPublicId(null); setOlderCursor(null); setActiveSavedRun(null); setLeaseExpiresAt(null);
        conversationId.current = null;
        setDisplayedId(null);
      }
      if (!routeId) {
        conversationId.current = null; revision.current = 0; pendingCreation.current = null;
        setDisplayedId(null);
        setCollectionId(""); setPrivateConversation(false);
        setDraft(""); setMessages([welcome]); setDocument(null); setPublicId(null); setOlderCursor(null); setActiveSavedRun(null); setLeaseExpiresAt(null); setOpening(false); setReady(true);
        return;
      }
      setOpening(true);
      try {
        const page = await loadConversation(routeId, controller.signal);
        if (!controller.signal.aborted) restore(page);
      } catch (error) {
        if (controller.signal.aborted) return;
        if (error instanceof GenerationRequestError && (error.status === 403 || error.status === 404)) {
          // The API checks ownership. Replace the rejected URL so Back cannot reopen it.
          window.history.replaceState(null, "", "/");
          return;
        }
        setError(error instanceof Error ? error.message : "Conversation could not be opened.");
      }
      finally { if (!controller.signal.aborted) setOpening(false); }
    });
    return () => controller.abort();
  }, [routeId, loadVersion]);
  useEffect(() => () => activeRequest.current?.abort(), []);
  useEffect(() => {
    if (!retrySeconds) return;
    const interval = setInterval(() => setRetrySeconds(Math.max(0, Math.ceil((retryAvailableAt.current - Date.now()) / 1000))), 250);
    return () => clearInterval(interval);
  }, [retrySeconds]);
  useEffect(() => {
    if (!activeSavedRun || isLoading || !routeId) return;
    // Reconcile once after the lease, rather than polling throughout generation.
    const timer = setTimeout(() => setLoadVersion(value => value + 1), Math.min(RUN_LEASE_MS + 1000, Math.max(1000, new Date(leaseExpiresAt ?? "").getTime() - Date.now() + 1000) || RUN_LEASE_MS));
    return () => clearTimeout(timer);
  }, [activeSavedRun, leaseExpiresAt, isLoading, routeId]);
  const hasUnsavedWork = !!draft.trim() || isLoading;
  useEffect(() => {
    if (!hasUnsavedWork) return;
    function warn(event: BeforeUnloadEvent) { event.preventDefault(); event.returnValue = true; }
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [hasUnsavedWork]);

  function navigate(path: string) {
    if (hasUnsavedWork) { pendingNavigation.current = path; resetDialog.current?.showModal(); keepWorking.current?.focus(); }
    else window.history.pushState(null, "", path);
  }
  function confirmNavigation() {
    resetDialog.current?.close(); activeRequest.current?.abort();
    window.history.pushState(null, "", pendingNavigation.current);
    if (pendingNavigation.current === pathname) setLoadVersion(value => value + 1);
  }
  async function olderMessages() {
    if (!conversationId.current || !olderCursor || loadingOlder) return;
    const id = conversationId.current;
    setLoadingOlder(true);
    try {
      const page = await loadConversation(id, undefined, olderCursor);
      if (conversationId.current !== id) return;
      setMessages(previous => [...page.messages.filter(message => !previous.some(saved => saved.id === message.id)), ...previous.filter(message => message.id !== "welcome")]);
      setOlderCursor(page.olderCursor);
    } catch (error) { setError(error instanceof Error ? error.message : "Earlier messages could not be loaded."); }
    finally { setLoadingOlder(false); }
  }

  async function generate(input: Submission, optimisticUserId?: string) {
    if (activeRequest.current) return;
    const controller = new AbortController(); activeRequest.current = controller;
    let replyId = crypto.randomUUID() as string;
    let accepted = false;
    let excluded = false;
    let requestFailure: string | null = null;
    setMessages(previous => [...previous, { id: replyId, role: "assistant", content: "", flow: [], tools: [], steps: [], runStatus: "running" }]);
    setRetryInput(input); setRetrySeconds(0); setIsLoading(true); setIsGenerating(false); setProgress(0); setPreview(null); setActivity("Saving your message…"); setError(null);
    const timeout = setTimeout(() => controller.abort(), CLIENT_GENERATION_TIMEOUT_MS);
    try {
      await requestGeneration(input, controller.signal, event => {
        if (activeRequest.current !== controller) return;
        if (event.type === "started") {
          accepted = true; revision.current = event.revision;
          const oldReplyId = replyId; replyId = event.assistantMessageId;
          setMessages(previous => previous.map(message => message.id === oldReplyId ? { ...message, id: replyId } : message.id === optimisticUserId ? { ...message, id: event.userMessageId } : message));
          setActivity("Checking your request…"); return;
        }
        setMessages(previous => previous.map(message => message.id === replyId ? applyEvent(message, event) : message));
        if (event.type === "preview") setPreview({ name: "draft.svg", description: "SVG in progress", ...event.svg });
        if (event.type === "activity") setActivity(`Step ${event.step}/6 · ${event.action === "webSearch" ? "Searching for references…" : event.action === "querySvg" ? "Reading current SVG…" : event.action === "validateSvg" ? "Drawing and checking SVG…" : "Working…"}`);
        if (event.type === "progress") { setIsGenerating(true); setProgress(event.characters); }
        if (event.type === "result") { setDocument(event.document); setPublicId(null); setPreview(null); setRetryInput(null); }
        if (event.type === "reply") setRetryInput(null);
        if (event.type === "error") { excluded = event.excludedFromContext ?? false; if (event.retryable === false) setRetryInput(null); }
      });
    } catch (error) {
      if (activeRequest.current !== controller) return;
      const text = controller.signal.aborted ? "Generation was interrupted. Reopen the conversation to check its saved state." : error instanceof Error ? error.message : "Generation failed. Please retry.";
      setError(text);
      setMessages(previous => previous.map(message => message.id === replyId ? finishDetails({ ...message, runStatus: "error", runError: text }) : message));
      if (!accepted) {
        requestFailure = text;
        setMessages(previous => previous.filter(message => message.id !== replyId && message.id !== optimisticUserId));
        if (input.kind === "message") setDraft(input.content);
      }
      if (error instanceof GenerationRequestError && error.status === 409) { setRetryInput(null); setLoadVersion(value => value + 1); }
      else if (!excluded) { retryAvailableAt.current = Date.now() + 15_000; setRetrySeconds(15); }
    } finally {
      clearTimeout(timeout);
      if (activeRequest.current === controller) {
        // Refresh canonical IDs/details, including success if its last stream event was lost.
        try {
          const page = await loadConversation(input.conversationId);
          if (activeRequest.current === controller) {
            restore(page, true);
            if (requestFailure) { setError(requestFailure); if (input.kind === "message") setRetryInput(null); }
          }
        } catch { if (activeRequest.current === controller && accepted) { setReady(false); setRetryInput(null); setError("Unable to confirm saved state. Reopen this conversation before continuing."); } }
        if (activeRequest.current === controller) { activeRequest.current = null; setIsLoading(false); setIsGenerating(false); setPreview(null); setHistoryRefresh(value => value + 1); }
      }
    }
  }
  async function sendMessage(content: string) {
    if (activeRequest.current || opening || activeSavedRun || !ready) return;
    const trimmed = content.trim();
    if (!trimmed || trimmed.length > 2000) return;
    if (!conversationId.current) {
      const controller = new AbortController(); activeRequest.current = controller; setIsLoading(true); setError(null);
      pendingCreation.current = pendingCreation.current?.content === trimmed ? pendingCreation.current : { id: crypto.randomUUID(), content: trimmed };
      try {
        const saved = await createConversation(pendingCreation.current.id, trimmed, controller.signal, collectionId || null);
        if (activeRequest.current !== controller) return;
        conversationId.current = saved.id; revision.current = saved.revision;
        setDisplayedId(saved.id);
        window.history.replaceState(null, "", `/conversations/${saved.id}`);
        setHistoryRefresh(value => value + 1);
      } catch (error) { if (activeRequest.current === controller) { setDraft(trimmed); setError(error instanceof Error ? error.message : "Conversation could not be saved."); } return; }
      finally { if (activeRequest.current === controller) { activeRequest.current = null; setIsLoading(false); } }
    }
    const parsed = submissionSchema.safeParse({ kind: "message", conversationId: conversationId.current, content: trimmed, requestId: crypto.randomUUID(), expectedRevision: revision.current });
    if (!parsed.success) { setError("Your message could not be submitted."); setDraft(trimmed); return; }
    const userId = crypto.randomUUID();
    setMessages(previous => [...previous.filter(message => message.id !== "welcome"), { id: userId, role: "user", content: trimmed }]);
    void generate(parsed.data, userId);
  }
  function retry() {
    if (!retryInput || Date.now() < retryAvailableAt.current) return;
    void generate(retryInput.kind === "retry" ? { ...retryInput, expectedRevision: revision.current } : retryInput);
  }
  if (opening || (routeId && routeId !== displayedId && !error)) return <WorkspaceSkeleton />;
  return <>{ragEnabled && <WorkspaceCollections conversationId={displayedId} hasArtwork={!!document} privateConversation={privateConversation} selected={collectionId} onSelect={setCollectionId} disabled={isLoading || !!activeSavedRun} onAdded={() => { setPrivateConversation(true); setPublicId(null); setLoadVersion(value => value + 1); }} />}<div className="grid min-h-0 flex-1 grid-cols-1 overflow-auto lg:grid-cols-[minmax(0,1fr)_380px] lg:grid-rows-[minmax(0,1fr)] lg:overflow-hidden xl:grid-cols-[minmax(0,1fr)_400px]">
    {routeId && !document && !preview ? <EmptySavedCanvas isLoading={isLoading} activity={activity} /> : <SvgCanvas document={preview ?? document ?? sampleDocument} publicId={!isLoading && !activeSavedRun && !preview ? publicId : null} hasPreview={!!preview} activity={activity} isSample={!document} isLoading={isGenerating} />}
    <ChatPanel messages={messages} onSend={content => void sendMessage(content)} onReset={() => navigate("/")} draft={draft} onDraftChange={setDraft}
      isLoading={isLoading || opening || !!activeSavedRun || !ready} progress={progress} activity={opening ? "Opening saved conversation…" : activeSavedRun && !isLoading ? "An earlier generation is still active. Refresh its status or wait for recovery." : activity}
      trackingEnabled={trackingEnabled && !privateConversation} error={error} retrySeconds={retrySeconds} onRetry={error && retryInput ? retry : undefined}
      currentId={routeId} historyRefresh={historyRefresh} onOpenConversation={id => navigate(`/conversations/${id}`)}
      olderCursor={olderCursor} loadingOlder={loadingOlder} onLoadOlder={() => void olderMessages()}
      onRefreshConversation={routeId && !isLoading ? () => setLoadVersion(value => value + 1) : undefined} />
    <dialog ref={resetDialog} aria-labelledby="reset-title" className="fixed inset-0 m-auto w-[calc(100%-2rem)] max-w-md rounded-2xl border border-stone-200 bg-white p-6 text-stone-800 shadow-xl backdrop:bg-stone-900/40">
      <h2 id="reset-title" className="text-lg font-semibold">Leave this workspace?</h2>
      <p className="mt-3 text-sm leading-6 text-stone-600">Saved conversations and artwork will remain in your history. Your unsent draft will be discarded, and any active generation will be interrupted.</p>
      <div className="mt-6 flex justify-end gap-3"><button ref={keepWorking} type="button" onClick={() => resetDialog.current?.close()} className="rounded-lg border border-stone-200 px-3 py-2 text-xs">Keep working</button><Button onClick={confirmNavigation}>Leave workspace</Button></div>
    </dialog>
  </div></>;
}
