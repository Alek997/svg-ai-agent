"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { MAX_PROMPT_LENGTH } from "@/lib/workspace/contracts";

export function ChatComposer({
  onSend,
  isLoading = false,
}: {
  onSend: (content: string) => void;
  isLoading?: boolean;
}) {
  const [draft, setDraft] = useState("");
  function submit() {
    const content = draft.trim();
    if (!content || isLoading) return;
    onSend(content);
    setDraft("");
  }
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
      className="border-t border-stone-200 p-5"
    >
      <div className="rounded-xl border border-stone-200 bg-white p-3 shadow-xs focus-within:border-stone-400">
        <label htmlFor="prompt" className="sr-only">
          Describe your SVG
        </label>
        <textarea
          id="prompt"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          maxLength={MAX_PROMPT_LENGTH}
          disabled={isLoading}
          rows={3}
          placeholder="Describe what you want to create…"
          className="w-full resize-none bg-transparent text-[13px] leading-6 outline-none placeholder:text-stone-400"
          onKeyDown={(event) => {
            if (
              event.key === "Enter" &&
              !event.shiftKey &&
              !event.nativeEvent.isComposing
            ) {
              event.preventDefault();
              submit();
            }
          }}
        />
        <div className="flex items-center justify-between">
          <span className="text-[10px] text-stone-400">
            {draft.length}/{MAX_PROMPT_LENGTH}
          </span>
          <Button
            type="submit"
            variant="primary"
            disabled={isLoading || !draft.trim()}
            aria-label="Send message"
            className="size-8 p-0"
          >
            <Icon name="arrow" width={16} height={16} />
          </Button>
        </div>
      </div>
      <p className="mt-3 text-center text-[10px] text-stone-400">
        Family-friendly artwork only · Shift + Enter for a new line
      </p>
    </form>
  );
}
