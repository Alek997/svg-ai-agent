// Test-bundle-only instrumentation; never imported by application builds.
export const renderCounts = new Map<string, number>();
export function recordRender(name: string) {
  renderCounts.set(name, (renderCounts.get(name) ?? 0) + 1);
}
