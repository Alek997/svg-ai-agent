// Edit these limits deliberately. A run makes one generation per selected case.
// Production generation keeps its own six-step/token/retry/deadline limits.
export const evalConfig = {
  suiteVersion: "svg-basics-v1",
  maxCases: 20,
  judge: {
    rubricVersion: "visual-checklist-v1",
    imageSize: 512,
    timeoutMs: 60_000,
    maxOutputTokens: 2000,
    maxRetries: 0,
  },
};
