export function hasRagCapability(metadata: unknown): boolean {
  if (
    !metadata ||
    typeof metadata !== "object" ||
    !("capabilities" in metadata)
  )
    return false;
  return (
    Array.isArray(metadata.capabilities) &&
    metadata.capabilities.includes("feature-rag")
  );
}
