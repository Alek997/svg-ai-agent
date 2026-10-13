import "server-only";

// Change provider defaults here. Existing environment overrides are resolved at
// request time by their callers. Each role stays independent of the drawing model.
export const modelDefaults = {
  drawing: "gpt-6-luna",
  scope: "gpt-6-luna",
  moderation: "omni-moderation-latest",
  collectionDescription: "gpt-6-luna",
  collectionEmbedding: "text-embedding-3-small",
  evalJudge: "gpt-6-luna",
} as const;

export const policyConfig = {
  timeoutMs: 15_000,
  maxRetries: 0,
  contextMessages: 4,
  maxResponseBytes: 32_000,
} as const;

export const collectionProviderConfig = {
  // Dimensions must remain compatible with the database vector schema.
  embeddingDimensions: 1536,
  descriptionVersion: "png-description-v3",
  maxDescriptionTokens: 300,
  timeoutMs: 30_000,
  maxRetries: 0,
  maxParallelEmbeddingCalls: 1,
  reasoningEffort: "none",
} as const;
