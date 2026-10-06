import "server-only";

import { createOpenAI } from "@ai-sdk/openai";
import { z } from "zod";

const environmentSchema = z.object({
  OPENAI_API_KEY: z.string().trim().min(1),
  OPENAI_MODEL: z.string().trim().min(1).default("gpt-4.1-mini"),
});

export function getLLM() {
  // Validate when generation is requested, so builds do not require a live key.
  const result = environmentSchema.safeParse({
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    OPENAI_MODEL: process.env.OPENAI_MODEL,
  });

  if (!result.success) {
    // Do not include environment values in errors or logs.
    throw new Error(
      "Set OPENAI_API_KEY in the server environment. OPENAI_MODEL must be non-empty when provided.",
    );
  }

  const openai = createOpenAI({ apiKey: result.data.OPENAI_API_KEY });

  return openai.responses(result.data.OPENAI_MODEL);
}
