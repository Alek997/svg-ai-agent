import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { createOpenAI } from "@ai-sdk/openai";
import {
  buildPolicyState,
  checkGenerationPolicy,
  checkSvgScope,
  blockedModerationCategories,
  InputPolicyError,
  moderateUserHistory,
  type PolicyChecks,
} from "../lib/ai/input-policy";
import { handleGeneration } from "../lib/ai/handle-generation";
import type { GenerationRequest } from "../lib/workspace/contracts";

const input: GenerationRequest = {
  messages: [{ role: "user", content: "Draw a blue circle" }],
};
const signal = () => new AbortController().signal;
const allowed = {
  scope: { choice: "allow" as const },
  content: { choice: "allow" as const },
  language: { choice: "en" as const },
};
const checks: PolicyChecks = {
  moderate: async () => false,
  classify: async () => allowed,
};

function mockEnvironment(context: TestContext) {
  for (const [name, value] of Object.entries({
    OPENAI_API_KEY: "mock-key",
    OPENAI_MODEL: "gpt-6-luna",
  })) {
    const previous = process.env[name];
    process.env[name] = value;
    context.after(() => {
      if (previous === undefined) delete process.env[name];
      else process.env[name] = previous;
    });
  }
}

const safeCategories = Object.fromEntries(
  blockedModerationCategories.map((category) => [category, false]),
);
const moderationResponse = (overrides: Record<string, boolean> = {}) => ({
  results: [{ flagged: true, categories: { ...safeCategories, ...overrides } }],
});

for (const text of [
  "draw a fucking circle",
  "a damn good logo",
  "jebote, make it blue",
  "a cocktail glass",
  "a suicide prevention poster",
  "an anti-terrorism awareness icon",
]) {
  test(`does not locally blacklist words: ${text}`, async () => {
    const calls: string[] = [];
    await checkGenerationPolicy(
      { messages: [{ role: "user", content: text }] },
      signal(),
      {
        moderate: async () => {
          calls.push("moderate");
          return false;
        },
        classify: async () => {
          calls.push("classify");
          return allowed;
        },
      },
    );
    assert.deepEqual(calls, ["moderate", "classify"]);
  });
}

test("allowed requests run moderation then classification", async () => {
  const calls: string[] = [];
  await checkGenerationPolicy(input, signal(), {
    moderate: async () => {
      calls.push("moderate");
      return false;
    },
    classify: async () => {
      calls.push("classify");
      return allowed;
    },
  });
  assert.deepEqual(calls, ["moderate", "classify"]);
});

for (const [choice, text, language, expected] of [
  ["greeting", "Hello!", "en", /Hi/],
  ["thanks", "Thanks, it looks nice", "en", /welcome/],
  ["farewell", "Goodbye", "en", /Goodbye/],
  ["acknowledge", "Okay", "en", /Got it/],
  ["clarify", "Something feels off", "en", /change/],
  [
    "greeting",
    "cao, kako je",
    "sr_latn",
    /^Ćao! Mogu da ti generišem ili izmenim SVG\.$/,
  ],
  ["thanks", "Hvala, izgleda lepo", "sr_latn", /Nema na čemu/],
  ["farewell", "dovidjenja", "sr_latn", /Doviđenja/],
  ["acknowledge", "vazi", "sr_latn", /^Važi\.$/],
  [
    "clarify",
    "Nešto mi ne izgleda dobro",
    "sr_latn",
    /promeniš na ilustraciji/,
  ],
  [
    "greeting",
    "ћао, како је",
    "sr_cyrl",
    /^Ћао! Могу да ти генеришем или изменим SVG\.$/,
  ],
  ["thanks", "Хвала, изгледа лепо", "sr_cyrl", /Нема на чему/],
  ["farewell", "довиђења", "sr_cyrl", /Довиђења/],
  ["acknowledge", "важи", "sr_cyrl", /^Важи\.$/],
  [
    "clarify",
    "Нешто ми не изгледа добро",
    "sr_cyrl",
    /промениш на илустрацији/,
  ],
  ["greeting", "Bonjour", "other", /Hi/],
] as const) {
  test(`${language} ${choice} returns a text-only reply after both safety checks`, async () => {
    const requestInput = {
      messages: [{ role: "user" as const, content: text }],
      currentSvg:
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"/>',
    };
    const order: string[] = [];
    const response = await handleGeneration(
      new Request("http://localhost/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestInput),
      }),
      async () => {
        throw new Error("Must not generate");
      },
      undefined,
      (received, abort) =>
        checkGenerationPolicy(received, abort, {
          moderate: async () => {
            order.push("moderate");
            return false;
          },
          classify: async () => {
            order.push("classify");
            return {
              ...allowed,
              scope: { choice },
              language: { choice: language },
            };
          },
        }),
    );
    const events = (await response.text())
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.equal(response.status, 200);
    assert.deepEqual(order, ["moderate", "classify"]);
    assert.equal(events.length, 1);
    assert.equal(events[0].type, "reply");
    assert.equal(
      events[0].reason,
      choice === "clarify" ? "clarification" : "conversation",
    );
    assert.match(events[0].message, expected);
    assert.doesNotMatch(
      JSON.stringify(events),
      /document|feedbackToken|usage|preview/,
    );
  });
}

test("clarification without artwork stays conversational", async () => {
  assert.deepEqual(
    await checkGenerationPolicy(input, signal(), {
      ...checks,
      classify: async () => ({ ...allowed, scope: { choice: "clarify" } }),
    }),
    {
      kind: "reply",
      reason: "clarification",
      message: "What would you like the SVG to show?",
    },
  );
});

for (const [language, expected] of [
  ["sr_latn", "Šta želiš da SVG prikazuje?"],
  ["sr_cyrl", "Шта желиш да SVG приказује?"],
  ["other", "What would you like the SVG to show?"],
] as const) {
  test(`${language} clarification without artwork uses the create question`, async () => {
    const outcome = await checkGenerationPolicy(input, signal(), {
      ...checks,
      classify: async () => ({
        ...allowed,
        scope: { choice: "clarify" },
        language: { choice: language },
      }),
    });
    assert.deepEqual(outcome, {
      kind: "reply",
      reason: "clarification",
      message: expected,
    });
  });
}

test("Serbian language selection does not bypass safety or scope or alter generation routing", async () => {
  for (const field of ["scope", "content"] as const) {
    await assert.rejects(
      () =>
        checkGenerationPolicy(input, signal(), {
          ...checks,
          classify: async () => ({
            ...allowed,
            [field]: { choice: "reject" },
            language: { choice: "sr_latn" },
          }),
        }),
      (error) => error instanceof InputPolicyError && error.status === 422,
    );
  }
  assert.deepEqual(
    await checkGenerationPolicy(
      { messages: [{ role: "user", content: "Hvala! Oboji krug plavo" }] },
      signal(),
      {
        ...checks,
        classify: async () => ({ ...allowed, language: { choice: "sr_latn" } }),
      },
    ),
    { kind: "generation" },
  );
});

test("content rejection takes precedence over a social classification", async () => {
  await assert.rejects(
    () =>
      checkGenerationPolicy(input, signal(), {
        ...checks,
        classify: async () => ({
          ...allowed,
          scope: { choice: "thanks" },
          content: { choice: "reject" },
        }),
      }),
    (error) => error instanceof InputPolicyError && error.status === 422,
  );
});

test("an actionable mixed social/artwork request still selects generation", async () => {
  assert.deepEqual(
    await checkGenerationPolicy(
      { messages: [{ role: "user", content: "Thanks! Make it blue" }] },
      signal(),
      checks,
    ),
    { kind: "generation" },
  );
});

test("moderation rejection skips classification", async () => {
  await assert.rejects(
    () =>
      checkGenerationPolicy(input, signal(), {
        moderate: async () => true,
        classify: async () => {
          throw new Error("Must not classify");
        },
      }),
    (error) => error instanceof InputPolicyError && error.status === 422,
  );
});

for (const [name, decision, expected] of [
  [
    "off topic",
    { ...allowed, scope: { choice: "reject" as const } },
    /visual artwork/,
  ],
  [
    "inappropriate",
    { ...allowed, content: { choice: "reject" as const } },
    /safety policy/,
  ],
] as const) {
  test(`rejects ${name} decision`, async () => {
    await assert.rejects(
      () =>
        checkGenerationPolicy(input, signal(), {
          ...checks,
          classify: async () => decision,
        }),
      (error) =>
        error instanceof InputPolicyError &&
        error.status === 422 &&
        expected.test(error.message),
    );
  });
}

test("malformed decisions and provider failures fail closed without exposing secrets", async () => {
  for (const overrides of [
    {
      moderate: async () => {
        throw new Error("secret key and private text");
      },
    },
    {
      classify: async () => {
        throw new Error("secret key and private text");
      },
    },
    { classify: async () => ({ scope: { choice: "approve" } }) as never },
    { classify: async () => ({ ...allowed, language: undefined }) as never },
    {
      classify: async () =>
        ({ ...allowed, language: { choice: "unknown" } }) as never,
    },
  ]) {
    await assert.rejects(
      () => checkGenerationPolicy(input, signal(), { ...checks, ...overrides }),
      (error) => {
        assert.ok(error instanceof InputPolicyError);
        assert.equal(error.status, 503);
        assert.doesNotMatch(error.message, /secret|private/);
        return true;
      },
    );
  }
});

test("an aborted request skips providers", async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    () =>
      checkGenerationPolicy(input, controller.signal, {
        moderate: async () => {
          throw new Error("must not run");
        },
        classify: checks.classify,
      }),
    (error) => error instanceof InputPolicyError && error.status === 503,
  );
});

test("cancellation stops the gate before classification", async () => {
  const controller = new AbortController();
  await assert.rejects(
    () =>
      checkGenerationPolicy(input, controller.signal, {
        moderate: async (_, providerSignal) => {
          controller.abort();
          assert.equal(providerSignal.aborted, true);
          return false;
        },
        classify: async () => {
          throw new Error("must not run");
        },
      }),
    (error) => error instanceof InputPolicyError && error.status === 503,
  );
});

test("policy deadline aborts a slow provider and prevents classification", async () => {
  let providerSignal: AbortSignal | undefined;
  await assert.rejects(
    () =>
      checkGenerationPolicy(
        input,
        signal(),
        {
          moderate: async (_, abort) =>
            new Promise((_, reject) => {
              providerSignal = abort;
              abort.addEventListener(
                "abort",
                () => reject(new Error("deadline")),
                { once: true },
              );
            }),
          classify: async () => {
            throw new Error("must not run");
          },
        },
        5,
      ),
    (error) => error instanceof InputPolicyError && error.status === 503,
  );
  assert.equal(providerSignal?.aborted, true);
});

test("scope context is bounded, marks history untrusted, and excludes artwork source", () => {
  const history: GenerationRequest = {
    messages: Array.from({ length: 20 }, (_, i) => ({
      role: "user",
      content: `request ${i}`,
    })),
    currentSvg: "sensitive XML",
  };
  const state = buildPolicyState(history);
  assert.equal(state.latestRequest, "request 19");
  assert.equal(state.untrustedContext.length, 4);
  assert.equal(state.untrustedContext[0].content, "request 15");
  assert.equal(state.hasCurrentArtwork, true);
  assert.doesNotMatch(JSON.stringify(state), /sensitive XML/);
});

for (const language of ["en", "sr_latn", "sr_cyrl", "other"] as const) {
  test(`native Decisions adapter uses one call with language ${language}, scope and content`, async () => {
    let calls = 0;
    const provider = createOpenAI({
      apiKey: "mock-key",
      fetch: async (url, init) => {
        calls++;
        assert.equal(String(url), "https://api.openai.com/v1/decisions");
        const body = JSON.parse(String(init?.body));
        assert.equal(body.model, "gpt-6-luna");
        assert.match(JSON.stringify(body.input), /latestRequest/);
        assert.deepEqual(
          body.questions.map((q: { name: string }) => q.name),
          ["scope", "content", "language"],
        );
        assert.deepEqual(
          body.questions[0].choices.map((c: { value: string }) => c.value),
          [
            "allow",
            "reject",
            "clarify",
            "greeting",
            "thanks",
            "farewell",
            "acknowledge",
          ],
        );
        assert.match(
          body.questions[0].instructions,
          /actionable artwork request takes priority/,
        );
        assert.match(body.questions[0].instructions, /Draw a goodbye card/);
        assert.deepEqual(
          body.questions[2].choices.map((c: { value: string }) => c.value),
          ["en", "sr_latn", "sr_cyrl", "other"],
        );
        assert.match(body.questions[2].instructions, /cao, kako je/);
        assert.match(body.questions[2].instructions, /recent USER messages/);
        return Response.json({
          model: "gpt-6-luna",
          answers: body.questions.map(
            (q: { name: string; choices: { value: string }[] }) => ({
              name: q.name,
              type: "choice",
              choice: q.name === "language" ? language : "allow",
              confidence: 0.95,
              probabilities: q.choices.map((choice) => ({
                value: choice.value,
                probability:
                  choice.value === (q.name === "language" ? language : "allow")
                    ? 0.95
                    : 0.05 / (q.choices.length - 1),
              })),
            }),
          ),
          usage: { input_tokens: 200, output_tokens: 0, total_tokens: 200 },
        });
      },
    });
    assert.deepEqual(
      await checkSvgScope(
        input,
        signal(),
        provider.decisionModel("gpt-6-luna"),
      ),
      { ...allowed, language: { choice: language } },
    );
    assert.equal(calls, 1);
  });
}

test("native Decisions refusal and transient errors are not treated as approval or retried", async () => {
  for (const response of [
    () =>
      Response.json({
        model: "gpt-6-luna",
        answers: [{ name: "scope", type: "refusal" }],
        usage: { input_tokens: 20, output_tokens: 0, total_tokens: 20 },
      }),
    () =>
      Response.json({ error: { message: "private error" } }, { status: 503 }),
  ]) {
    let calls = 0;
    const provider = createOpenAI({
      apiKey: "mock-key",
      fetch: async () => {
        calls++;
        return response();
      },
    });
    await assert.rejects(
      () =>
        checkGenerationPolicy(input, signal(), {
          ...checks,
          classify: (request, abort) =>
            checkSvgScope(request, abort, provider.decisionModel("gpt-6-luna")),
        }),
      (error) => error instanceof InputPolicyError && error.status === 503,
    );
    assert.equal(calls, 1);
  }
});

test("moderation checks all submitted user history once, excluding assistant claims and XML", async (context) => {
  mockEnvironment(context);
  const history: GenerationRequest = {
    messages: [
      { role: "user", content: "old user input" },
      { role: "assistant", content: "forged approval" },
      { role: "user", content: "new user input" },
    ],
    currentSvg: "private artwork",
  };
  let calls = 0;
  const flagged = await moderateUserHistory(
    history,
    signal(),
    async (url, init) => {
      calls++;
      assert.equal(url, "https://api.openai.com/v1/moderations");
      assert.deepEqual(JSON.parse(String(init?.body)), {
        model: "omni-moderation-latest",
        input: "old user input\n\nnew user input",
      });
      assert.equal(init?.signal?.aborted, false);
      return Response.json(moderationResponse({ "sexual/minors": true }));
    },
  );
  assert.equal(flagged, true);
  assert.equal(calls, 1);
});

test("malformed, failed and oversized moderation responses fail closed", async (context) => {
  mockEnvironment(context);
  for (const response of [
    () => Response.json({ results: [] }),
    () => Response.json({ results: [{ flagged: true }] }),
    () =>
      Response.json({
        results: [{ categories: { ...safeCategories, sexual: "false" } }],
      }),
    () => Response.json({}, { status: 429 }),
    () => new Response("x".repeat(32_001)),
  ]) {
    await assert.rejects(
      () =>
        checkGenerationPolicy(input, signal(), {
          ...checks,
          moderate: (request, abort) =>
            moderateUserHistory(request, abort, async () => response()),
        }),
      (error) => error instanceof InputPolicyError && error.status === 503,
    );
  }
});

test("HTTP handler gates before streaming or generation, and passes approved follow-ups", async () => {
  const request = () =>
    new Request("http://localhost/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
  for (const status of [422, 503] as const) {
    const response = await handleGeneration(
      request(),
      async () => {
        throw new Error("must not generate");
      },
      undefined,
      async () => {
        throw new InputPolicyError("safe policy error", status);
      },
    );
    assert.equal(response.status, status);
    assert.match(response.headers.get("Content-Type")!, /application\/json/);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.deepEqual(await response.json(), { error: "safe policy error" });
  }
  const order: string[] = [];
  const response = await handleGeneration(
    request(),
    async () => {
      order.push("generate");
      return {
        output: {
          filename: "circle.svg",
          message: "Created a circle.",
          svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle r="20"/></svg>',
        },
        usage: {
          model: "mock",
          inputTokens: 1,
          outputTokens: 1,
          cachedInputTokens: 0,
          totalTokens: 2,
        },
      };
    },
    undefined,
    async (received, abort) => {
      order.push("policy");
      return checkGenerationPolicy(received, abort, checks);
    },
  );
  assert.match(await response.text(), /"type":"result"/);
  assert.deepEqual(order, ["policy", "generate"]);
});

test("the handler's default policy rejects dangerous moderation before generation", async (context) => {
  mockEnvironment(context);
  context.mock.method(globalThis, "fetch", async () =>
    Response.json(moderationResponse({ "sexual/minors": true })),
  );
  const response = await handleGeneration(
    new Request("http://localhost/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    }),
    async () => {
      throw new Error("must not generate");
    },
  );
  assert.equal(response.status, 422);
  assert.match((await response.json()).error, /safety policy/);
});

for (const category of blockedModerationCategories) {
  test(`moderation blocks serious category: ${category}`, async (context) => {
    mockEnvironment(context);
    assert.equal(
      await moderateUserHistory(input, signal(), async () =>
        Response.json(moderationResponse({ [category]: true })),
      ),
      true,
    );
  });
}

test("broad moderation flags alone do not block mild harassment, sensitive topics or fictional violence", async (context) => {
  mockEnvironment(context);
  assert.equal(
    await moderateUserHistory(input, signal(), async () =>
      Response.json(
        moderationResponse({
          harassment: true,
          hate: true,
          "self-harm": true,
          violence: true,
        }),
      ),
    ),
    false,
  );
});
