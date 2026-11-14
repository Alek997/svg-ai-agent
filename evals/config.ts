// Edit these limits deliberately. A run makes one generation per selected case.
// Production generation keeps its own six-step/token/retry/deadline limits.
export const evalConfig = {
  suiteVersion: "svg-eval-infrastructure-v2",
  regressionDataset: "cases-v1",
  challengeDataset: "challenge-v2",
  maxCases: 100,
  judge: {
    rubricVersion: "visual-checklist-v2",
    renderingVersion: "opaque-gray-v2",
    background: "#e5e7eb",
    imageSize: 512,
    timeoutMs: 60_000,
    maxOutputTokens: 2000,
    maxRetries: 0,
  },
};
