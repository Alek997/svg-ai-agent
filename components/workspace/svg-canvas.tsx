"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import type { SvgDocument } from "@/lib/workspace/types";
import { ShareSvg } from "./share-svg";
import { useSvgBlobRef } from "@/lib/workspace/use-svg-blob-ref";

export function SvgCanvas({
  document,
  isSample = false,
  isLoading = false,
  hasPreview = false,
  activity = "Working…",
  publicId = null,
}: {
  document: SvgDocument;
  isSample?: boolean;
  isLoading?: boolean;
  hasPreview?: boolean;
  activity?: string;
  publicId?: string | null;
}) {
  const [view, setView] = useState<"preview" | "source">("preview");
  const [zoom, setZoom] = useState(100);
  const [copyFeedback, setCopyFeedback] = useState<{
    source: string;
    status: "copied" | "error";
  } | null>(null);
  const copyStatus =
    copyFeedback?.source === document.source ? copyFeedback.status : null;
  const attachImage = useSvgBlobRef<HTMLImageElement>(document.source, "src");
  const attachDownload = useSvgBlobRef<HTMLAnchorElement>(
    document.source,
    "href",
  );
  useEffect(() => {
    if (copyFeedback?.status !== "copied") return;
    const timeout = setTimeout(() => setCopyFeedback(null), 2000);
    return () => clearTimeout(timeout);
  }, [copyFeedback]);

  async function copySource() {
    const source = document.source;
    try {
      await navigator.clipboard.writeText(source);
      setCopyFeedback({ source, status: "copied" });
    } catch {
      setCopyFeedback({ source, status: "error" });
    }
  }

  return (
    <section
      aria-labelledby="canvas-title"
      className="flex min-h-0 min-w-0 flex-col"
    >
      <div className="flex min-h-[65px] shrink-0 flex-wrap items-center justify-between gap-4 border-b border-stone-200 bg-white px-5 py-3 sm:px-7">
        <div className="flex items-center gap-3">
          <h2 id="canvas-title" className="text-sm font-medium">
            Canvas
          </h2>
          <span className="rounded-md bg-stone-100 px-2 py-1 text-[10px] text-stone-500">
            {isLoading ? "Generating…" : isSample ? "Sample" : "Generated"}
          </span>
        </div>
        <div className="flex min-w-0 flex-wrap items-center justify-end gap-4">
          {publicId && !isLoading && <ShareSvg key={publicId} id={publicId} />}
          <div
            className="flex gap-1 rounded-lg bg-stone-100 p-1"
            role="group"
            aria-label="Canvas view"
          >
            <Button
              onClick={() => setView("preview")}
              aria-pressed={view === "preview"}
              variant="ghost"
              className={
                view === "preview" ? "bg-white text-stone-900 shadow-xs" : ""
              }
            >
              <Icon name="canvas" width={14} height={14} />
              Preview
            </Button>
            <Button
              onClick={() => setView("source")}
              aria-pressed={view === "source"}
              variant="ghost"
              className={
                view === "source" ? "bg-white text-stone-900 shadow-xs" : ""
              }
            >
              <Icon name="code" width={14} height={14} />
              Code
            </Button>
          </div>
        </div>
      </div>
      <div
        aria-busy={isLoading}
        className="canvas-grid relative flex min-h-[430px] flex-1 flex-col items-center justify-center overflow-hidden p-6 sm:p-12 lg:min-h-0"
      >
        {isLoading && (
          <div
            role="status"
            className="absolute top-4 z-10 flex items-center gap-2 rounded-lg border border-stone-200 bg-white/95 px-4 py-2 text-xs text-stone-600 shadow-sm"
          >
            <span className="h-3 w-3 animate-spin rounded-full border-2 border-stone-300 border-t-stone-700" />
            {activity}
          </div>
        )}
        {isLoading && !hasPreview && isSample && view === "preview" && (
          <div
            aria-hidden="true"
            className="absolute h-64 w-64 animate-pulse rounded-2xl border border-stone-200 bg-stone-100"
          />
        )}
        {view === "preview" ? (
          <>
            <div className="absolute top-6 left-6 text-[10px] uppercase tracking-[0.15em] text-stone-400">
              Artboard 01
            </div>
            <div className="flex min-h-0 w-full flex-1 items-center justify-center overflow-auto py-8">
              {/* SVG is rendered as an image, never injected into the page DOM. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                ref={attachImage}
                alt={document.description}
                width={document.width}
                height={document.height}
                className={`${isLoading && !hasPreview && isSample ? "invisible" : ""} h-auto max-h-full max-w-full shrink-0 object-contain drop-shadow-xl transition-transform`}
                style={{
                  width: document.width,
                  transform: `scale(${zoom / 100})`,
                }}
              />
            </div>
            <p className="mt-3 text-xs text-stone-500">
              An idea, brought into view.
            </p>
            <p className="mt-2 text-[11px] text-stone-400">
              {isLoading
                ? "Your next artwork is on its way"
                : isSample
                  ? "Example artwork · Describe your own in the chat"
                  : "Send a follow-up message to refine your artwork"}
            </p>
          </>
        ) : (
          <div className="w-full overflow-hidden rounded-xl border border-stone-200 bg-white">
            <div className="flex items-center justify-between gap-3 border-b border-stone-200 px-4 py-2">
              <span className="text-xs text-stone-500">SVG source</span>
              <Button
                variant="ghost"
                onClick={copySource}
                disabled={isLoading}
                aria-label="Copy SVG code"
              >
                <Icon name="copy" width={14} height={14} />
                {copyStatus === "copied" ? "Copied!" : "Copy code"}
              </Button>
            </div>
            <p
              role="status"
              className={
                copyStatus === "error"
                  ? "px-4 pt-3 text-xs text-red-600"
                  : "sr-only"
              }
            >
              {copyStatus === "copied"
                ? "SVG code copied to clipboard."
                : copyStatus === "error"
                  ? "Could not copy. Try again or select the code and copy it manually."
                  : ""}
            </p>
            <pre
              aria-label="SVG source"
              className="max-h-[60vh] w-full overflow-auto p-6 text-xs leading-7 text-stone-600"
            >
              <code>{document.source}</code>
            </pre>
          </div>
        )}
        <div className="mt-7 flex items-center gap-1 rounded-xl border border-stone-200 bg-white p-1 shadow-xs">
          <Button
            variant="ghost"
            onClick={() => setZoom((value) => value / 1.25)}
            disabled={view === "source"}
            aria-label="Zoom out"
          >
            <Icon name="minus" width={14} height={14} />
          </Button>
          <span className="min-w-12 px-1 text-center text-xs tabular-nums text-stone-600">
            {zoom.toLocaleString(undefined, { maximumSignificantDigits: 3 })}%
          </span>
          <Button
            variant="ghost"
            onClick={() => setZoom((value) => value * 1.25)}
            disabled={view === "source"}
            aria-label="Zoom in"
          >
            <Icon name="plus" width={14} height={14} />
          </Button>
          <span className="mx-1 h-4 border-l border-stone-200" />
          <Button
            variant="ghost"
            onClick={() => setZoom(100)}
            disabled={view === "source"}
            aria-label="Reset zoom"
          >
            <Icon name="reset" width={14} height={14} />
          </Button>
        </div>
      </div>
      <footer className="flex min-h-[61px] shrink-0 items-center justify-between gap-3 border-t border-stone-200 bg-white px-5 sm:px-7">
        <div className="min-w-0">
          <p className="truncate text-xs text-stone-600">{document.name}</p>
          <p className="mt-1 text-[10px] text-stone-400">
            {document.width} × {document.height} · SVG
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {isLoading ? (
            <Button disabled className="shrink-0">
              <Icon name="download" width={14} height={14} />
              Download SVG
            </Button>
          ) : (
            <a
              ref={attachDownload}
              download={document.name}
              className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-stone-200 px-3 py-2 text-xs font-medium text-stone-600 hover:bg-stone-50"
            >
              <Icon name="download" width={14} height={14} />
              Download SVG
            </a>
          )}
        </div>
      </footer>
    </section>
  );
}
