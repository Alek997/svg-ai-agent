import assert from "node:assert/strict";
import { test } from "node:test";
import {
  getConfiguredModel,
  getConfiguredModelLabel,
  modelEnvironmentVariables,
} from "../lib/ai/config";
import { collectionModels } from "../lib/collections/providers";

test("every model role requires its own environment setting, resolved at call time", (context) => {
  for (const [role, variable] of Object.entries(modelEnvironmentVariables)) {
    const previous = process.env[variable];
    context.after(() => {
      if (previous === undefined) delete process.env[variable];
      else process.env[variable] = previous;
    });
    const modelRole = role as keyof typeof modelEnvironmentVariables;
    delete process.env[variable];
    assert.throws(() => getConfiguredModel(modelRole), new RegExp(variable));
    process.env[variable] = " ";
    assert.throws(() => getConfiguredModel(modelRole), new RegExp(variable));
    process.env[variable] = `  configured-${role}  `;
    assert.equal(getConfiguredModel(modelRole), `configured-${role}`);
  }
  assert.equal(
    collectionModels().description,
    "configured-collectionDescription",
  );
  assert.equal(collectionModels().embedding, "configured-collectionEmbedding");
  assert.equal(collectionModels().dimensions, 1536);
});

test("public label never falls back to the provider model ID", (context) => {
  for (const variable of ["OPENAI_MODEL", "OPENAI_MODEL_LABEL"]) {
    const previous = process.env[variable];
    context.after(() => {
      if (previous === undefined) delete process.env[variable];
      else process.env[variable] = previous;
    });
  }
  process.env.OPENAI_MODEL = "private-provider-id";
  delete process.env.OPENAI_MODEL_LABEL;
  assert.equal(getConfiguredModelLabel(), "SVG assistant");
  process.env.OPENAI_MODEL_LABEL = "  ";
  assert.equal(getConfiguredModelLabel(), "SVG assistant");
  process.env.OPENAI_MODEL_LABEL = "  Studio artist  ";
  assert.equal(getConfiguredModelLabel(), "Studio artist");
});
