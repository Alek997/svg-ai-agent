import assert from "node:assert/strict";
import { test } from "node:test";
import { createPaidRequestGuard } from "./e2e/live/generator";
import {
  liveApprovalToken,
  liveSmokeLimits,
  liveSmokePreflight,
  requireLiveSmokeApproval,
} from "./e2e/live/settings";

const endpoint = "https://api.openai.com/v1/responses";
const requestOptions = (
  changes: Record<string, unknown> = {},
): RequestInit => ({
  method: "POST",
  body: JSON.stringify({
    model: "test-model",
    store: false,
    max_output_tokens: 2048,
    input: "A circle",
    ...changes,
  }),
});

test("paid smoke preflight never reveals credentials or sends network requests", (context) => {
  const previousKey = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "synthetic-secret-that-must-not-be-printed";
  context.after(() => {
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
  });
  context.mock.method(globalThis, "fetch", () => {
    throw new Error("Preflight must not make network calls");
  });
  const settings = liveSmokePreflight();
  assert.equal(settings.credentialPresent, true);
  assert.ok(!JSON.stringify(settings).includes(process.env.OPENAI_API_KEY));
  assert.equal(settings.providerRequests, 3);
});

test("paid smoke requires explicit approval and the exact approved model", (context) => {
  const names = [
    "E2E_LIVE_APPROVAL",
    "E2E_LIVE_APPROVED_MODEL",
    "OPENAI_MODEL",
    "OPENAI_API_KEY",
  ] as const;
  const previous = names.map((name) => process.env[name]);
  context.after(() => {
    names.forEach((name, index) => {
      if (previous[index] === undefined) delete process.env[name];
      else process.env[name] = previous[index];
    });
  });
  process.env.OPENAI_MODEL = "test-model";
  process.env.OPENAI_API_KEY = "synthetic-key";
  delete process.env.E2E_LIVE_APPROVAL;
  assert.throws(requireLiveSmokeApproval, /paid and disabled/);
  process.env.E2E_LIVE_APPROVAL = liveApprovalToken;
  process.env.E2E_LIVE_APPROVED_MODEL = "another-model";
  assert.throws(requireLiveSmokeApproval, /exactly match/);
  process.env.E2E_LIVE_APPROVED_MODEL = "test-model";
  assert.equal(requireLiveSmokeApproval().model, "test-model");
});

test("paid request cap blocks the fourth outbound request before fetch", async () => {
  let calls = 0;
  const guard = createPaidRequestGuard("test-model", async () => {
    calls++;
    return Response.json({ ok: true });
  });
  for (let i = 0; i < 3; i++) await guard.fetch(endpoint, requestOptions());
  await assert.rejects(
    () => guard.fetch(endpoint, requestOptions()),
    /outside its approved/,
  );
  assert.equal(calls, 3);
  assert.equal(guard.stats().providerRequests, 3);
});

test("paid request guard blocks unsafe budgets, destinations, models and provider storage before fetch", async () => {
  for (const [url, changes] of [
    ["https://example.com/responses", {}],
    [endpoint, { model: "another-model" }],
    [endpoint, { store: true }],
    [endpoint, { max_output_tokens: 2049 }],
    [endpoint, { max_output_tokens: 0 }],
    [
      endpoint,
      { input: "a".repeat(liveSmokeLimits.serializedInputBytesPerRequest) },
    ],
  ] as const) {
    let calls = 0;
    const guard = createPaidRequestGuard("test-model", async () => {
      calls++;
      return Response.json({ ok: true });
    });
    await assert.rejects(
      () => guard.fetch(url, requestOptions(changes)),
      /outside its approved/,
    );
    assert.equal(calls, 0);
  }
});

test("provider HTTP and network failures stop all further outbound attempts", async () => {
  for (const failHttp of [true, false]) {
    let calls = 0;
    const guard = createPaidRequestGuard("test-model", async () => {
      calls++;
      if (failHttp)
        return Response.json(
          { error: "Synthetic rate limit" },
          { status: 429 },
        );
      throw new Error("Synthetic network failure");
    });
    if (failHttp)
      assert.equal((await guard.fetch(endpoint, requestOptions())).status, 429);
    else
      await assert.rejects(
        () => guard.fetch(endpoint, requestOptions()),
        /outbound retries are disabled/,
      );
    await assert.rejects(
      () => guard.fetch(endpoint, requestOptions()),
      /budget is stopped/,
    );
    assert.equal(calls, 1);
  }
});
