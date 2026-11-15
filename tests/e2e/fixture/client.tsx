import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { SvgWorkspace } from "../../../components/workspace/svg-workspace";
import "../../browser/navigation";

const root = document.getElementById("root")!;
const generationLabel =
  root.dataset.generationMode === "paid"
    ? "paid live generation"
    : "synthetic generation";

createRoot(root).render(
  <StrictMode>
    <main className="flex h-dvh flex-col overflow-hidden">
      <header className="shrink-0 border-b border-stone-200 bg-white px-5 py-3 text-xs text-stone-500">
        SVG Studio · isolated E2E fixture · {generationLabel} · in-memory saved
        conversations
      </header>
      <SvgWorkspace />
    </main>
  </StrictMode>,
);
