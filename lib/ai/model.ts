import "server-only";

import { createOpenAI } from "@ai-sdk/openai";
import { z } from "zod";
import { ModelConfigurationError } from "./errors";

export const DEFAULT_OPENAI_MODEL = "gpt-6-luna";

const environmentSchema = z.object({
  OPENAI_API_KEY: z.string().trim().min(1),
  OPENAI_MODEL: z.string().trim().min(1).default(DEFAULT_OPENAI_MODEL),
});

function getEnvironment() {
  // Validate when generation is requested, so builds do not require a live key.
  const result = environmentSchema.safeParse({
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    OPENAI_MODEL: process.env.OPENAI_MODEL,
  });

  if (!result.success) {
    // Do not include environment values in errors or logs.
    throw new ModelConfigurationError();
  }

  return result.data;
}

export function getOpenAIKey() {
  return getEnvironment().OPENAI_API_KEY;
}

export function getOpenAIProvider() {
  return createOpenAI({ apiKey: getOpenAIKey() });
}

export function getLLM() {
  const environment = getEnvironment();
  return createOpenAI({ apiKey: environment.OPENAI_API_KEY }).responses(environment.OPENAI_MODEL);
}

// The header needs only the public model name, never API credentials.
export function getConfiguredModelName() {
  const result = environmentSchema.shape.OPENAI_MODEL.safeParse(process.env.OPENAI_MODEL);
  return result.success ? result.data : "Unavailable";
}
