export class ModelConfigurationError extends Error {
  constructor() {
    super(
      "Configure OPENAI_API_KEY in .env.local on the server. OPENAI_MODEL must be non-empty when provided.",
    );
  }
}
