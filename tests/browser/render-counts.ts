// Test-bundle-only instrumentation; never imported by application builds.
export const renderCounts = new Map<string, number>();
// Imported by the instrumentation transform in effects-server.mts.
// fallow-ignore-next-line unused-export
export function recordRender(name: string) {
  renderCounts.set(name, (renderCounts.get(name) ?? 0) + 1);
}
