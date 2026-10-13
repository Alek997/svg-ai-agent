"use client";

import { useEffect, useId, useRef, useState } from "react";
import {
  feedbackReasons,
  feedbackRequestSchema,
} from "@/lib/workspace/feedback";

export function GenerationFeedback({
  token,
  expiresAt,
}: {
  token: string;
  expiresAt?: number;
}) {
  const [expired, setExpired] = useState<number | null>(null);
  useEffect(() => {
    if (!expiresAt) return;
    let timer: ReturnType<typeof setTimeout>;
    function check() {
      const remaining = expiresAt! - Date.now();
      if (remaining <= 0) setExpired(expiresAt!);
      else timer = setTimeout(check, Math.min(remaining, 2_147_483_647));
    }
    timer = setTimeout(check, 0);
    return () => clearTimeout(timer);
  }, [expiresAt]);

  if (expiresAt !== undefined && expired === expiresAt)
    return (
      <p className="mt-3 text-xs text-stone-400">Feedback period has ended.</p>
    );

  return <FeedbackForm key={token} token={token} />;
}

function FeedbackForm({ token }: { token: string }) {
  const id = useId();
  const [rating, setRating] = useState<0 | 1 | null>(null);
  const [comment, setComment] = useState("");
  const [reason, setReason] = useState("");
  const [status, setStatus] = useState<
    { kind: "idle" | "saving" | "saved" } | { kind: "error"; message: string }
  >({ kind: "idle" });
  const sending = useRef(false);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sending.current) return;
    const parsed = feedbackRequestSchema.safeParse({
      token,
      rating,
      comment,
      ...(rating === 0 && reason ? { reason } : {}),
    });
    if (!parsed.success) return;
    sending.current = true;
    setStatus({ kind: "saving" });
    try {
      const response = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
        signal: AbortSignal.timeout(20_000),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || body.ok !== true)
        throw new Error(
          typeof body.error === "string"
            ? body.error
            : "Feedback could not be saved. Please try again.",
        );
      setStatus({ kind: "saved" });
    } catch (error) {
      setStatus({
        kind: "error",
        message:
          error instanceof Error
            ? error.message
            : "Feedback could not be saved. Please try again.",
      });
    } finally {
      sending.current = false;
    }
  }

  if (status.kind === "saved")
    return (
      <p role="status" className="mt-3 text-xs text-stone-500">
        Thanks for your feedback.
      </p>
    );

  return (
    <form onSubmit={submit} className="mt-3 space-y-2 text-xs text-stone-600">
      <fieldset disabled={status.kind === "saving"} className="space-y-2">
        <legend className="sr-only">Rate this SVG (optional)</legend>
        <div className="flex items-center gap-1 text-stone-400">
          <span className="mr-1">Rate this SVG</span>
          {([1, 0] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-label={value === 1 ? "Good generation" : "Poor generation"}
              aria-pressed={rating === value}
              onClick={() => {
                setRating(value);
                setStatus({ kind: "idle" });
              }}
              className={`rounded-md px-2 py-1 disabled:opacity-50 ${rating === value ? "bg-stone-100 text-stone-700" : "hover:bg-stone-50 hover:text-stone-600"}`}
            >
              <span aria-hidden="true">{value === 1 ? "👍" : "👎"}</span>
            </button>
          ))}
        </div>
        {rating !== null && (
          <>
            {rating === 0 && (
              <div>
                <label htmlFor={`${id}-reason`} className="mb-1 block">
                  What could be better? (optional)
                </label>
                <select
                  id={`${id}-reason`}
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  className="w-full rounded-md border border-stone-200 bg-white p-2"
                >
                  <option value="">Choose a reason</option>
                  {feedbackReasons.map((reason) => (
                    <option key={reason}>{reason}</option>
                  ))}
                </select>
              </div>
            )}
            <label htmlFor={`${id}-comment`} className="block">
              Comment (optional)
            </label>
            <textarea
              id={`${id}-comment`}
              value={comment}
              maxLength={1000}
              rows={2}
              onChange={(event) => setComment(event.target.value)}
              className="w-full rounded-md border border-stone-200 p-2"
            />
            <button
              type="submit"
              className="rounded-md border border-stone-200 px-3 py-1.5 hover:bg-stone-50 disabled:opacity-50"
            >
              {status.kind === "saving" ? "Sending…" : "Send feedback"}
            </button>
          </>
        )}
      </fieldset>
      {status.kind === "error" && (
        <p role="alert" className="text-red-700">
          {status.message}
        </p>
      )}
    </form>
  );
}
