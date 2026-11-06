"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import {
  blankRating,
  problemTags,
  visualQualityRubric,
  type SavedReview,
} from "@/lib/eval-review/contracts";

export function ReviewForm({
  initialReview,
  save,
  nextId,
  nextPage,
}: {
  initialReview: SavedReview | null;
  save: (rating: unknown) => Promise<{ review?: SavedReview; error?: string }>;
  nextId?: string;
  nextPage?: string;
}) {
  const initial = initialReview ?? blankRating;
  const [reviewer, setReviewer] = useState(initialReview?.reviewer ?? null);
  const [skipped, setSkipped] = useState(initial.skipped);
  const [status, setStatus] = useState<{ message: string; error?: boolean }>();
  const [saveAndAdvance, setSaveAndAdvance] = useState(false);
  const [saving, startSave] = useTransition();
  const router = useRouter();
  const tags = [...new Set([...problemTags, ...initial.problems])];

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    const data = new FormData(event.currentTarget);
    const quality = data.get("quality");
    const acceptable = data.get("acceptable");
    const advance =
      (event.nativeEvent as SubmitEvent).submitter?.getAttribute("value") ===
      "next";
    const rating = {
      quality: skipped || !quality ? null : Number(quality),
      acceptable: skipped || !acceptable ? null : acceptable === "true",
      problems: data.getAll("problem"),
      notes: data.get("notes"),
      skipped,
    };

    setStatus(undefined);
    setSaveAndAdvance(advance);
    startSave(async () => {
      try {
        const result = await save(rating);
        if (!result.review) {
          setStatus({
            message: result.error ?? "Could not save the review. Try again.",
            error: true,
          });
          return;
        }
        setReviewer(result.review.reviewer);
        setStatus({ message: "Review saved." });
        if (advance) {
          if (nextId) document.getElementById(nextId)?.focus();
          else if (nextPage) {
            startSave(() => router.push(nextPage));
          }
        }
      } catch {
        setStatus({
          message: "Could not save the review. Try again.",
          error: true,
        });
      }
    });
  }

  const inputClass =
    "mt-1 w-full rounded-md border border-stone-300 bg-white px-2 py-1.5 disabled:bg-stone-100";

  return (
    <form
      className="mt-5 border-t border-stone-200 pt-4 text-sm"
      method="post"
      onSubmit={submit}
      aria-busy={saving}
    >
      <h3 className="font-semibold">Human review</h3>
      {reviewer && (
        <p className="mt-1 break-words text-stone-600">
          Last saved by {reviewer}
        </p>
      )}
      <fieldset disabled={saving} className="mt-3 space-y-3">
        <legend className="sr-only">Review fields</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <label>
            Visual quality
            <select
              className={inputClass}
              name="quality"
              defaultValue={initial.quality ?? ""}
              disabled={skipped}
            >
              <option value="">Unscored</option>
              {visualQualityRubric.map(({ anchor }, index) => (
                <option key={anchor} value={index + 1}>
                  {index + 1} · {anchor}
                </option>
              ))}
            </select>
          </label>
          <label>
            Would you deliver this result?
            <select
              className={inputClass}
              name="acceptable"
              defaultValue={
                initial.acceptable === null ? "" : String(initial.acceptable)
              }
              disabled={skipped}
            >
              <option value="">Unscored</option>
              <option value="true">Yes</option>
              <option value="false">No</option>
            </select>
          </label>
        </div>
        <fieldset>
          <legend>Problems</legend>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
            {tags.map((tag) => (
              <label key={tag} className="inline-flex items-center gap-1.5">
                <input
                  name="problem"
                  value={tag}
                  type="checkbox"
                  defaultChecked={initial.problems.includes(tag)}
                />
                {tag}
              </label>
            ))}
          </div>
        </fieldset>
        <label className="block">
          Notes
          <textarea
            className={inputClass}
            name="notes"
            defaultValue={initial.notes}
            maxLength={5000}
            rows={2}
          />
        </label>
        <label className="flex items-center gap-2">
          <input
            name="skipped"
            type="checkbox"
            checked={skipped}
            onChange={(event) => setSkipped(event.target.checked)}
          />
          Skip / uncertain
        </label>
        <div className="flex flex-wrap gap-2">
          <button
            type="submit"
            className="cursor-pointer rounded-md bg-stone-900 px-3 py-1.5 font-medium text-white active:bg-stone-700 disabled:cursor-wait disabled:opacity-50"
          >
            {saving && !saveAndAdvance ? "Saving…" : "Save review"}
          </button>
          {(nextId || nextPage) && (
            <button
              type="submit"
              value="next"
              className="cursor-pointer rounded-md border border-stone-300 px-3 py-1.5 font-medium active:bg-stone-100 disabled:cursor-wait disabled:opacity-50"
            >
              {saving && saveAndAdvance
                ? status?.message
                  ? "Opening next…"
                  : "Saving…"
                : "Save & next"}
            </button>
          )}
        </div>
      </fieldset>
      <p
        role={status?.error ? "alert" : "status"}
        className={`mt-2 min-h-5 ${status?.error ? "text-red-700" : "text-stone-600"}`}
      >
        {saving && !status ? "Saving review…" : status?.message}
      </p>
    </form>
  );
}
