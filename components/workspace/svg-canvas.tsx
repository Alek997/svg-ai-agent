"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import type { SvgDocument } from "@/lib/workspace/types";

export function SvgCanvas({
  document,
  isSample = false,
  isLoading = false,
}: {
  document: SvgDocument;
  isSample?: boolean;
  isLoading?: boolean;
}) {
  const [view, setView] = useState<"preview" | "source">("preview");
  const [zoom, setZoom] = useState(100);
  const image = useRef<HTMLImageElement>(null);
  const download = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    const objectUrl = URL.createObjectURL(
      new Blob([document.source], { type: "image/svg+xml" }),
    );
    if (image.current) image.current.src = objectUrl;
    if (download.current) download.current.href = objectUrl;
    return () => URL.revokeObjectURL(objectUrl);
  }, [document.source, view]);

  return (
    <section
      aria-labelledby="canvas-title"
      className="flex min-h-0 min-w-0 flex-col"
    >
      <div className="flex h-[65px] shrink-0 items-center justify-between border-b border-stone-200 bg-white px-5 sm:px-7">
        <div className="flex items-center gap-3">
          <h2 id="canvas-title" className="text-sm font-medium">
            Canvas
          </h2>
          <span className="rounded-md bg-stone-100 px-2 py-1 text-[10px] text-stone-500">
            {isLoading ? "Generating…" : isSample ? "Sample" : "Generated"}
          </span>
        </div>
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
      <div className="canvas-grid relative flex min-h-[430px] flex-1 flex-col items-center justify-center overflow-hidden p-6 sm:p-12">
        {view === "preview" ? (
          <>
            <div className="absolute top-6 left-6 text-[10px] uppercase tracking-[0.15em] text-stone-400">
              Artboard 01
            </div>
            <div className="flex min-h-0 w-full flex-1 items-center justify-center overflow-auto py-8">
              {/* SVG is rendered as an image, never injected into the page DOM. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                ref={image}
                alt={document.description}
                width={document.width}
                height={document.height}
                className="h-auto max-h-full max-w-full shrink-0 object-contain drop-shadow-xl transition-transform"
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
          <pre
            aria-label="SVG source"
            className="max-h-[60vh] w-full overflow-auto rounded-xl border border-stone-200 bg-white p-6 text-xs leading-7 text-stone-600"
          >
            <code>{document.source}</code>
          </pre>
        )}
        <div className="mt-7 flex items-center gap-1 rounded-xl border border-stone-200 bg-white p-1 shadow-xs">
          <Button
            variant="ghost"
            onClick={() => setZoom(Math.max(50, zoom - 25))}
            disabled={zoom === 50 || view === "source"}
            aria-label="Zoom out"
          >
            <Icon name="minus" width={14} height={14} />
          </Button>
          <span className="w-12 text-center text-xs tabular-nums text-stone-600">
            {zoom}%
          </span>
          <Button
            variant="ghost"
            onClick={() => setZoom(Math.min(150, zoom + 25))}
            disabled={zoom === 150 || view === "source"}
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
      <footer className="flex min-h-[61px] items-center justify-between gap-3 border-t border-stone-200 bg-white px-5 sm:px-7">
        <div className="min-w-0">
          <p className="truncate text-xs text-stone-600">{document.name}</p>
          <p className="mt-1 text-[10px] text-stone-400">
            {document.width} × {document.height} · SVG
          </p>
        </div>
        <a
          ref={download}
          download={document.name}
          className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-stone-200 px-3 py-2 text-xs font-medium text-stone-600 hover:bg-stone-50"
        >
          <Icon name="download" width={14} height={14} />
          Download SVG
        </a>
      </footer>
    </section>
  );
}
