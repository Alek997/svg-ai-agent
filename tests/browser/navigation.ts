// Browser-fixture adapter only. Production uses next/navigation.
import { useSyncExternalStore } from "react";
export function usePathname() {
  return useSyncExternalStore(
    (callback) => {
      window.addEventListener("popstate", callback);
      return () => window.removeEventListener("popstate", callback);
    },
    () => window.location.pathname,
  );
}
for (const method of ["pushState", "replaceState"] as const) {
  const original = history[method].bind(history);
  history[method] = (...args) => {
    original(...args);
    window.dispatchEvent(new PopStateEvent("popstate"));
  };
}
