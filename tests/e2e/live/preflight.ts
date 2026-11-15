import { liveApprovalToken, liveSmokePreflight } from "./settings";

console.log(
  "LIVE SMOKE PREFLIGHT — no network calls are made by this command.",
);
console.log(JSON.stringify(liveSmokePreflight(), null, 2));
console.log(
  `Execution requires E2E_LIVE_APPROVAL=${liveApprovalToken} and E2E_LIVE_APPROVED_MODEL matching the model above. Do not execute until the paid limits have been reviewed and approved.`,
);
