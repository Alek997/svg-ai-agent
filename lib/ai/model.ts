import "server-only";

import { createOpenAI } from "@ai-sdk/openai";
import { z } from "zod";
import { getConfiguredModel } from "./config";
import { ModelConfigurationError } from "./errors";

const apiKeySchema = z.string().trim().min(1);

export function getOpenAIKey() {
  // Validate only when needed; never include environment values in errors.
  const result = apiKeySchema.safeParse(process.env.OPENAI_API_KEY);
  if (!result.success) throw new ModelConfigurationError();
  return result.data;
}

export function getOpenAIProvider() {
  return createOpenAI({ apiKey: getOpenAIKey() });
}

export function getLLM() {
  return getOpenAIProvider().responses(getConfiguredModel("drawing"));
}
