import { WorkspaceViewport } from "../../../components/workspace/workspace-viewport";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { WorkspaceHeaderContent } from "../../../components/workspace/workspace-header-content";
import { SvgWorkspace } from "../../../components/workspace/svg-workspace";
import "../../browser/navigation";

const root = document.getElementById("root")!;
const generationLabel =
  root.dataset.generationMode === "paid"
    ? "paid live generation"
    : "synthetic generation";

createRoot(root).render(
  <StrictMode>
    <WorkspaceViewport>
      <WorkspaceHeaderContent
        showCollections={
          !new URLSearchParams(location.search).has("basic-navigation")
        }
        showEvalRuns={
          !new URLSearchParams(location.search).has("basic-navigation")
        }
        modelLabel={generationLabel}
        accountMenu={
          <button
            type="button"
            aria-label="Open user menu"
            className="size-8 rounded-full bg-stone-100"
          >
            A
          </button>
        }
      />
      <SvgWorkspace
        ragEnabled={new URLSearchParams(location.search).has("collections")}
        trackingEnabled
      />
    </WorkspaceViewport>
  </StrictMode>,
);
