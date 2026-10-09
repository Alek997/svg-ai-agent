import { RunDetails } from "./run-details";
import { GenerationFeedback } from "./generation-feedback";
import { Icon } from "@/components/ui/icon";
import type { ChatMessage as Message } from "@/lib/workspace/types";

export function ChatMessage({ message }: { message: Message }) {
  const isAssistant = message.role === "assistant";
  return (
    <article className={`flex gap-3 ${isAssistant ? "" : "flex-row-reverse"}`}>
      {isAssistant && (
        <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg border border-stone-200 bg-white">
          <Icon name="sparkles" width={14} height={14} />
        </span>
      )}
      <div
        className={
          isAssistant
            ? "min-w-0 flex-1"
            : "max-w-[90%] rounded-xl bg-stone-100 px-4 py-3"
        }
      >
        <p className="mb-1.5 text-[11px] font-medium text-stone-500">
          {isAssistant ? "SVG Studio" : "You"}
        </p>
        {isAssistant && (message.runStatus || message.tools?.length || message.steps?.length) && <RunDetails message={message} />}
        <p className="whitespace-pre-wrap break-words text-[13px] leading-6 text-stone-600">
          {message.content}
        </p>
        {isAssistant && message.usage && (
          <div className="mt-2 text-[11px] leading-5 text-stone-400">
            <p title="Token usage for this request, including conversation history and current artwork. Cached input is included in the input count.">
              {message.usage.totalTokens?.toLocaleString("en-US") ?? "Unknown"} tokens
              {" · "}
              {message.usage.inputTokens?.toLocaleString("en-US") ?? "Unknown"} input
              {" · "}
              {message.usage.outputTokens?.toLocaleString("en-US") ?? "Unknown"} output tokens
              {message.usage.cachedInputTokens !== null && message.usage.cachedInputTokens > 0 &&
                ` · ${message.usage.cachedInputTokens.toLocaleString("en-US")} input cached`}
            </p>
          </div>
        )}
        {isAssistant && message.runStatus === "completed" && message.feedbackToken && <GenerationFeedback token={message.feedbackToken} />}
      </div>
    </article>
  );
}
