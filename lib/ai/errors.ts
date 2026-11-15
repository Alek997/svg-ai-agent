export class ModelConfigurationError extends Error {
  constructor(variable = "OPENAI_API_KEY") {
    super(
      `Configure ${variable} with a non-empty value in .env.local on the server.`,
    );
  }
}
