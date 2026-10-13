/* eslint-disable @next/next/no-html-link-for-pages -- This isolated fixture has no Next router. */
import { createRoot } from "react-dom/client";
import { CollectionManager } from "../../components/collections/collection-manager";
import { SvgWorkspace } from "../../components/workspace/svg-workspace";
import { usePathname } from "./navigation";
function Fixture() {
  const pathname = usePathname();
  return (
    <main
      className={
        pathname === "/collections" ? "" : "flex h-dvh flex-col overflow-hidden"
      }
    >
      <header className="flex shrink-0 flex-wrap gap-4 border-b border-stone-200 bg-white p-4 text-xs">
        <strong>
          Synthetic browser fixture · mocked policy/providers · disposable DB
        </strong>
        <a href="/">Workspace</a>
        <a href="/collections">Collections</a>
        <button
          onClick={() =>
            void fetch("/__fixture/fail-embedding", { method: "POST" })
          }
        >
          Fail next embedding
        </button>
        <button
          onClick={() =>
            void fetch("/__fixture/fail-generation", { method: "POST" })
          }
        >
          Fail next generation request
        </button>
        <button
          onClick={() =>
            void fetch("/__fixture/invalid-svg", { method: "POST" })
          }
        >
          Return invalid SVG next
        </button>
      </header>
      {pathname === "/collections" ? (
        <CollectionManager />
      ) : (
        <SvgWorkspace
          ragEnabled
          initialConversationId={
            pathname.startsWith("/conversations/")
              ? pathname.split("/")[2]
              : undefined
          }
        />
      )}
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<Fixture />);
