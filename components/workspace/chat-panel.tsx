"use client";

import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { ChatComposer } from "./chat-composer";
import { ChatMessage } from "./chat-message";
import type { ChatMessage as Message } from "@/lib/workspace/types";

type ChatPanelProps = {
  messages: Message[];
  onSend: (content: string) => void;
  onReset: () => void;
  isLoading: boolean;
  progress: number;
  activity: string;
  error: string | null;
  onRetry?: () => void;
};

export function ChatPanel({
  messages,
  onSend,
  onReset,
  isLoading,
  progress,
  activity,
  error,
  onRetry,
}: ChatPanelProps) {
  const history = useRef<HTMLDivElement>(null);
  useEffect(() => {
    history.current?.scrollTo({
      top: history.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, isLoading, error]);
  return (
    <aside
      aria-labelledby="chat-title"
      className="flex min-h-0 flex-col border-t border-stone-200 bg-white lg:border-t-0 lg:border-l"
    >
      <div className="flex h-[65px] shrink-0 items-center justify-between border-b border-stone-200 px-5">
        <h2
          id="chat-title"
          className="flex items-center gap-2 text-sm font-medium"
        >
          <Icon name="chat" width={16} height={16} />
          Conversation
        </h2>
        <Button
          variant="ghost"
          onClick={onReset}
          aria-label="Start a new conversation"
          title="New conversation"
        >
          <Icon name="plus" width={16} height={16} />
        </Button>
      </div>
      <div
        ref={history}
        role="log"
        aria-label="Conversation history"
        aria-live="polite"
        className="min-h-0 flex-1 space-y-6 overflow-y-auto p-5"
      >
        <p className="text-center text-[10px] uppercase tracking-[0.15em] text-stone-400">
          A little inspiration goes a long way
        </p>
        {messages.map((message) => (
          <ChatMessage key={message.id} message={message} />
        ))}
        {isLoading && (
          <p role="status" className="ml-10 text-xs text-stone-500">
            {activity}{progress > 0 ? ` · ${progress.toLocaleString()} characters` : ""}
          </p>
        )}
        {messages.length === 1 && !isLoading && (
          <div className="ml-10 space-y-2 pt-2">
            <p className="mb-3 text-[11px] text-stone-400">Try starting with</p>
            {[
              "A minimal mountain landscape",
              "A friendly robot in soft colors",
              "A geometric flower icon",
            ].map((prompt) => (
              <button
                key={prompt}
                onClick={() => onSend(prompt)}
                className="block w-full rounded-lg border border-stone-200 px-3 py-2.5 text-left text-xs text-stone-600 transition-colors hover:border-stone-400 hover:bg-stone-50"
              >
                {prompt}
                <span className="float-right text-stone-400">↗</span>
              </button>
            ))}
          </div>
        )}
      </div>
      {error && (
        <div
          role="alert"
          className="mx-5 mb-4 rounded-lg border border-red-200 bg-red-50 p-3 text-xs leading-5 text-red-800"
        >
          <p>{error}</p>
          {onRetry && (
            <Button onClick={onRetry} disabled={isLoading} className="mt-2">
              Retry generation
            </Button>
          )}
        </div>
      )}
      <ChatComposer onSend={onSend} isLoading={isLoading} />
    </aside>
  );
}
