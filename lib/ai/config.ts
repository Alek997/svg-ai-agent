import "server-only";

import { z } from "zod";
import { ModelConfigurationError } from "./errors";

// Resolve lazily: builds need no provider configuration, and roles remain independent.
export const modelEnvironmentVariables = {
  drawing: "OPENAI_MODEL",
  scope: "OPENAI_SCOPE_MODEL",
  moderation: "OPENAI_MODERATION_MODEL",
  collectionDescription: "COLLECTION_DESCRIPTION_MODEL",
  collectionEmbedding: "COLLECTION_EMBEDDING_MODEL",
  evalJudge: "EVAL_JUDGE_MODEL",
} as const;

const modelNameSchema = z.string().trim().min(1);

export function getConfiguredModel(
  role: keyof typeof modelEnvironmentVariables,
) {
  const variable = modelEnvironmentVariables[role];
  const result = modelNameSchema.safeParse(process.env[variable]);
  if (!result.success) throw new ModelConfigurationError(variable);
  return result.data;
}

export function getConfiguredModelLabel() {
  return process.env.OPENAI_MODEL_LABEL?.trim() || "SVG assistant";
}

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
