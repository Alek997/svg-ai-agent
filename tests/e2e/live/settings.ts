// No providers or network imports: safe to run before approving any paid request.
export const liveSmokeLimits = {
  browserSubmissions: 1,
  providerRequests: 3,
  outputTokensPerRequest: 2048,
  serializedInputBytesPerRequest: 32_000,
  timeoutMs: 90_000,
} as const;
export const liveSmokePrompt =
  "Create a minimal amber circle icon on a transparent background, using a 120 by 120 viewBox. Keep the SVG very small. Do not use web search.";
export const liveApprovalToken = "I_ACCEPT_PAID_OPENAI_REQUESTS";

export function liveSmokePreflight() {
  const model = process.env.OPENAI_MODEL?.trim();
  return {
    model: model || "NOT CONFIGURED",
    credentialPresent: !!process.env.OPENAI_API_KEY?.trim(),
    prompt: liveSmokePrompt,
    ...liveSmokeLimits,
    providerRetries: 0,
    playwrightRetries: 0,
    policy:
      "Synthetic approval of this fixed safe prompt; no real policy calls",
    disabled: ["web search", "collections", "tracking", "visual judge"],
    coverage:
      "Production drawing agent prompts/tools/finalization, server SVG validation, HTTP stream, workspace, and download; in-memory persistence and test navigation",
    cost: "Paid; capped requests/tokens are not a fixed dollar-price guarantee. Limit exhaustion fails instead of extending the budget.",
  };
}

export function requireLiveSmokeApproval() {
  const settings = liveSmokePreflight();
  if (process.env.E2E_LIVE_APPROVAL !== liveApprovalToken)
    throw new Error(
      "Live smoke is paid and disabled. Run npm run test:e2e:live:preflight, then explicitly approve it before setting E2E_LIVE_APPROVAL.",
    );
  if (settings.model === "NOT CONFIGURED" || !settings.credentialPresent)
    throw new Error(
      "Live smoke requires server-side OPENAI_MODEL and OPENAI_API_KEY.",
    );
  if (process.env.E2E_LIVE_APPROVED_MODEL !== settings.model)
    throw new Error(
      "E2E_LIVE_APPROVED_MODEL must exactly match the model shown by the preflight.",
    );
  return settings;
}
