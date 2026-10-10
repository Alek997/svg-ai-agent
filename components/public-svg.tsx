"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "./ui/button";

type ArtworkState = { kind: "loading" | "missing" | "error" } | { kind: "ready"; url: string };

export function PublicSvg({ id }: { id: string }) {
  const [state, setState] = useState<ArtworkState>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState(false);
  const endpoint = `/api/public/svgs/${encodeURIComponent(id)}`;

  useEffect(() => {
    const controller = new AbortController();
    let url: string | undefined;
    void (async () => {
      try {
        const response = await fetch(endpoint, { cache: "no-store", signal: controller.signal });
        if (!response.ok) {
          setState({ kind: response.status === 404 ? "missing" : "error" });
          return;
        }
        const blob = await response.blob();
        if (controller.signal.aborted) return;
        url = URL.createObjectURL(blob);
        setState({ kind: "ready", url });
      } catch {
        if (!controller.signal.aborted) setState({ kind: "error" });
      }
    })();
    return () => { controller.abort(); if (url) URL.revokeObjectURL(url); };
  }, [endpoint, attempt]);

  async function download() {
    setDownloading(true); setDownloadError(false);
    try {
      // Re-read so deletion after opening the page produces the unavailable state.
      const response = await fetch(endpoint, { cache: "no-store" });
      if (!response.ok) {
        if (response.status === 404) setState({ kind: "missing" });
        else setDownloadError(true);
        return;
      }
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement("a");
      anchor.href = url; anchor.download = "artwork.svg";
      document.body.append(anchor); anchor.click(); anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch { setDownloadError(true); }
    finally { setDownloading(false); }
  }

  return (
    <main className="flex min-h-dvh flex-col bg-stone-50 text-stone-800">
      <header className="flex items-center justify-between border-b border-stone-200 bg-white px-6 py-5">
        <h1 className="text-sm font-semibold">Shared SVG</h1>
        <Link href="/" className="text-sm text-stone-600 hover:underline">Open SVG Studio</Link>
      </header>
      {state.kind === "ready" ? (
        <>
          <div className="canvas-grid flex flex-1 items-center justify-center p-6 sm:p-12">
            {/* Validated markup stays in the browser's restricted SVG image renderer. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={state.url} alt="Shared SVG artwork" className="max-h-[70dvh] max-w-full object-contain" onError={() => setState({ kind: "error" })} />
          </div>
          <footer className="flex flex-col items-center gap-3 border-t border-stone-200 bg-white p-5">
            <Button onClick={() => void download()} disabled={downloading}>{downloading ? "Checking SVG…" : "Download SVG"}</Button>
            {downloadError && <p role="alert" className="text-sm text-red-700">Download failed. Please try again.</p>}
          </footer>
        </>
      ) : (
        <section className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center" aria-live="polite">
          <h2 className="text-xl font-semibold">{state.kind === "loading" ? "Loading SVG…" : state.kind === "missing" ? "SVG unavailable" : "Could not load SVG"}</h2>
          {state.kind !== "loading" && <>
            <p className="max-w-sm text-sm text-stone-600">{state.kind === "missing" ? "This artwork may have been deleted, or the link is invalid." : "Please try again in a moment."}</p>
            <div className="flex gap-3">
              {state.kind === "error" && <Button onClick={() => { setState({ kind: "loading" }); setAttempt(value => value + 1); }}>Try again</Button>}
              <Link href="/" className="rounded-lg bg-stone-900 px-4 py-2 text-sm text-white">Go to SVG Studio</Link>
            </div>
          </>}
        </section>
      )}
    </main>
  );
}
