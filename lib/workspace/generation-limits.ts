// Shared timing keeps the browser from cancelling before the server can finish.
// This module contains public constants only; it is safe for client imports.
// Finish before Vercel Hobby's 300-second ceiling to allow response cleanup.
export const GENERATION_TIMEOUT_MS = 290_000;
export const CLIENT_GENERATION_TIMEOUT_MS = GENERATION_TIMEOUT_MS + 10_000;

// Leave room for a complete SVG tool argument while bounding each model call.
export const MAX_OUTPUT_TOKENS = 32_768;
export const MAX_PROVIDER_RETRIES = 2;
