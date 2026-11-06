import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { createEvalReview } from "../lib/eval-review/service";

const projectId = "42c90c3c-0d44-4b50-8888-8dd25736052a";
const firstRun = "52c90c3c-0d44-4b50-8888-8dd25736052a";
const secondRun = "62c90c3c-0d44-4b50-8888-8dd25736052a";
const unrelatedProject = "72c90c3c-0d44-4b50-8888-8dd25736052a";

test("only an eval admin can list runs, and only from the configured project", async () => {
  let requests = 0;
  const review = createEvalReview({
    authorize: async (userId) => userId === "admin",
    project: "svg-ai-agent",
    apiKey: "fixture",
    fetch: async (input) => {
      requests++;
      const url = new URL(String(input));
      if (url.pathname === "/v1/project") {
        assert.equal(url.searchParams.get("project_name"), "svg-ai-agent");
        return Response.json({
          objects: [{ id: projectId, name: "svg-ai-agent" }],
        });
      }
      assert.equal(url.pathname, "/v1/experiment");
      assert.equal(url.searchParams.get("project_id"), projectId);
      return Response.json({
        objects: [
          {
            id: secondRun,
            project_id: projectId,
            name: "Second",
            created: "2026-11-02T00:00:00Z",
          },
          {
            id: firstRun,
            project_id: projectId,
            name: "First",
            created: null,
          },
          {
            id: unrelatedProject,
            project_id: unrelatedProject,
            name: "Unrelated",
            created: "2026-11-03T00:00:00Z",
          },
        ],
      });
    },
  });
  await assert.rejects(review.listRuns("collections-only"), { status: 403 });
  await assert.rejects(review.listRuns(null), { status: 403 });
  assert.equal(requests, 0);
  const page = await review.listRuns("admin");
  assert.deepEqual(page.runs, [
    { id: secondRun, name: "Second", created: "2026-11-02T00:00:00Z" },
    { id: firstRun, name: "First", created: null },
  ]);
});

test("the directory continues from the last visible provider cursor", async () => {
  const runs = Array.from({ length: 11 }, (_, index) => ({
    id: `${index + 10}c90c3c-0d44-4b50-8888-8dd25736052a`,
    project_id: projectId,
    name: `Run ${index + 1}`,
    created: null,
  }));
  const review = createEvalReview({
    authorize: async () => true,
    project: "svg-ai-agent",
    apiKey: "fixture",
    fetch: async (input) => {
      const url = new URL(String(input));
      if (url.pathname === "/v1/project")
        return Response.json({
          objects: [{ id: projectId, name: "svg-ai-agent" }],
        });
      const after = url.searchParams.get("starting_after");
      if (after) assert.equal(after, runs[9].id);
      return Response.json({ objects: after ? [runs[10]] : runs });
    },
  });
  const first = await review.listRuns("admin");
  assert.equal(first.runs.length, 10);
  assert.equal(first.nextCursor, runs[9].id);
  const second = await review.listRuns("admin", first.nextCursor);
  assert.deepEqual(
    second.runs.map((run) => run.name),
    ["Run 11"],
  );
  assert.equal(second.nextCursor, undefined);
});

test("an eval admin opens a blind preview of a completed generation", async () => {
  const source =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/></svg>';
  const review = createEvalReview({
    authorize: async (userId) => userId === "admin",
    project: "svg-ai-agent",
    apiKey: "fixture",
    fetch: async (input) => {
      const url = new URL(String(input));
      if (url.pathname === "/v1/project")
        return Response.json({
          objects: [{ id: projectId, name: "svg-ai-agent" }],
        });
      if (url.pathname === "/v1/experiment") {
        assert.equal(url.searchParams.get("project_id"), projectId);
        assert.equal(url.searchParams.get("ids"), firstRun);
        return Response.json({
          objects: [
            { id: firstRun, project_id: projectId, name: "secret-model-run" },
          ],
        });
      }
      if (url.pathname === "/btql") return Response.json({ data: [] });
      assert.equal(url.pathname, `/v1/experiment/${firstRun}/fetch`);
      return Response.json({
        events: [
          {
            id: "circle-row",
            experiment_id: firstRun,
            input: {
              id: "circle",
              input: { messages: [{ role: "user", content: "Draw a circle" }] },
            },
            output: {
              status: "completed",
              source,
              usage: { model: "secret-model" },
            },
            scores: { automated_quality: 0.75, human_visual_quality: 0.8 },
          },
        ],
      });
    },
  });
  assert.deepEqual(await review.getRun("admin", firstRun), {
    cases: [
      {
        id: "circle-row",
        messages: [{ role: "user", content: "Draw a circle" }],
        before: null,
        after: source,
        outputSha256: createHash("sha256").update(source).digest("hex"),
        review: null,
      },
    ],
    nextCursor: null,
  });
});

test("direct review requires eval access and a run in the configured project", async () => {
  const paths: string[] = [];
  const review = createEvalReview({
    authorize: async (userId) => userId === "admin",
    project: "svg-ai-agent",
    apiKey: "fixture",
    fetch: async (input) => {
      const { pathname } = new URL(String(input));
      paths.push(pathname);
      if (pathname === "/v1/project")
        return Response.json({
          objects: [{ id: projectId, name: "svg-ai-agent" }],
        });
      return Response.json({
        objects: [
          { id: firstRun, project_id: unrelatedProject, name: "Unrelated" },
          { id: secondRun, project_id: projectId, name: "Wrong run" },
        ],
      });
    },
  });
  await assert.rejects(review.getRun(null, firstRun), { status: 403 });
  await assert.rejects(review.getRun("collections-only", firstRun), {
    status: 403,
  });
  await assert.rejects(review.getRun("admin", "../invalid"), { status: 404 });
  assert.deepEqual(paths, []);
  await assert.rejects(review.getRun("admin", firstRun), { status: 404 });
  assert.deepEqual(paths, ["/v1/project", "/v1/experiment"]);
});

test("only completed root outputs with safe artwork can enter blind review", async () => {
  const before =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg>';
  const after =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>';
  const unsafe =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><script>alert(1)</script></svg>';
  const messages = [
    { role: "user", content: "Replace the circle with a square" },
  ];
  const row = {
    id: "edit-row",
    experiment_id: firstRun,
    span_parents: [],
    input: { input: { messages, currentSvg: before } },
    output: { status: "completed", source: after },
  };
  const cursor = "opaque+/=";
  const review = createEvalReview({
    authorize: async () => true,
    project: "svg-ai-agent",
    apiKey: "fixture",
    fetch: async (input, init) => {
      const url = new URL(String(input));
      if (url.pathname === "/v1/project")
        return Response.json({
          objects: [{ id: projectId, name: "svg-ai-agent" }],
        });
      if (url.pathname === "/v1/experiment")
        return Response.json({
          objects: [{ id: firstRun, project_id: projectId, name: "Edit run" }],
        });
      if (url.pathname === "/btql") return Response.json({ data: [] });
      assert.equal(init?.method, "POST");
      const body = JSON.parse(String(init?.body));
      if (body.cursor !== undefined) {
        assert.deepEqual(body, { limit: 10, cursor });
        return Response.json({ events: [row] });
      }
      assert.deepEqual(body, { limit: 10 });
      return Response.json({
        events: [
          { ...row, id: "failed", output: { status: "failed", source: after } },
          { ...row, id: "errored", error: "Generation error" },
          { ...row, id: "child", span_parents: ["root"] },
          { ...row, id: "other-run", experiment_id: secondRun },
          {
            ...row,
            id: "unsafe-result",
            output: { ...row.output, source: unsafe },
          },
          {
            ...row,
            id: "unsafe-original",
            input: { input: { messages, currentSvg: unsafe } },
          },
        ],
        cursor,
      });
    },
  });
  assert.deepEqual(await review.getRun("admin", firstRun), {
    cases: [
      {
        id: "edit-row",
        messages,
        before,
        after,
        outputSha256: createHash("sha256").update(after).digest("hex"),
        review: null,
      },
    ],
    nextCursor: null,
  });
});

test("saving writes only the selected output's human review under the authenticated reviewer", async () => {
  const source =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/></svg>';
  const outputSha256 = createHash("sha256").update(source).digest("hex");
  const feedback: unknown[] = [];
  let status = "completed";
  const review = createEvalReview({
    authorize: async (userId) => userId === "admin",
    project: "svg-ai-agent",
    apiKey: "fixture",
    fetch: async (input, init) => {
      const { pathname } = new URL(String(input));
      if (pathname === "/v1/project")
        return Response.json({
          objects: [{ id: projectId, name: "svg-ai-agent" }],
        });
      if (pathname === "/v1/experiment")
        return Response.json({
          objects: [{ id: firstRun, project_id: projectId, name: "Run" }],
        });
      if (pathname === "/btql")
        return Response.json({
          data: [
            {
              id: "circle-row",
              experiment_id: firstRun,
              input: {
                input: {
                  messages: [{ role: "user", content: "Draw a circle" }],
                },
              },
              output: { status, source },
            },
          ],
        });
      assert.equal(pathname, `/v1/experiment/${firstRun}/feedback`);
      feedback.push(JSON.parse(String(init?.body)));
      return Response.json({ status: "success" });
    },
  });
  const rating = {
    quality: 4,
    acceptable: false,
    problems: ["composition"],
    notes: "Off-center",
    skipped: false,
  };
  const payload = { id: "circle-row", outputSha256, rating };
  await assert.rejects(
    review.saveReview("collections-only", firstRun, payload),
    { status: 403 },
  );
  await assert.rejects(
    review.saveReview("admin", firstRun, {
      ...payload,
      rating: { ...rating, notes: "x".repeat(5001) },
    }),
    { status: 400 },
  );
  await assert.rejects(review.saveReview("admin", secondRun, payload), {
    status: 404,
  });
  status = "failed";
  await assert.rejects(review.saveReview("admin", firstRun, payload), {
    status: 404,
  });
  status = "completed";
  await assert.rejects(
    review.saveReview("admin", firstRun, {
      ...payload,
      outputSha256: "0".repeat(64),
    }),
    { status: 409 },
  );
  assert.deepEqual(feedback, []);
  assert.deepEqual(await review.saveReview("admin", firstRun, payload), {
    ...rating,
    reviewer: "admin",
  });
  assert.deepEqual(feedback, [
    {
      feedback: [
        {
          id: "circle-row",
          scores: { human_visual_quality: 0.8, human_acceptable: 0 },
          metadata: {
            humanReview: {
              ...rating,
              rubricVersion: "human-visual-quality-v1",
              outputSha256,
              reviewer: "admin",
            },
          },
          source: "external",
        },
      ],
    },
  ]);
});

test("opening a run restores the latest matching synced review without automated scores", async () => {
  const source =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>';
  const outputSha256 = createHash("sha256").update(source).digest("hex");
  const synced = {
    quality: 4,
    acceptable: false,
    problems: ["composition"],
    notes: "Legacy note",
    skipped: false,
    reviewer: "Local reviewer",
  };
  const auditRow = (xact: string, notes: string) => ({
    id: "reviewed-row",
    _xact_id: xact,
    audit_data: {
      action: "merge",
      metadata: {
        humanReview: {
          ...synced,
          notes,
          outputSha256,
          rubricVersion: "human-visual-quality-v1",
        },
      },
    },
  });
  const service = createEvalReview({
    authorize: async () => true,
    project: "svg-ai-agent",
    apiKey: "fixture",
    fetch: async (input, init) => {
      const { pathname } = new URL(String(input));
      if (pathname === "/v1/project")
        return Response.json({
          objects: [{ id: projectId, name: "svg-ai-agent" }],
        });
      if (pathname === "/v1/experiment")
        return Response.json({
          objects: [{ id: firstRun, project_id: projectId, name: "Run" }],
        });
      if (pathname === "/btql") {
        const { audit_log, query } = JSON.parse(String(init?.body));
        assert.equal(audit_log, true);
        if (!query.cursor)
          return Response.json(
            { data: [auditRow("002", synced.notes)] },
            { headers: { "x-bt-cursor": "more-history" } },
          );
        assert.equal(query.cursor, "more-history");
        return Response.json({ data: [auditRow("001", "Older note")] });
      }
      return Response.json({
        events: [
          {
            id: "reviewed-row",
            experiment_id: firstRun,
            input: {
              input: { messages: [{ role: "user", content: "Draw a square" }] },
            },
            output: { status: "completed", source },
            scores: {
              human_visual_quality: 0.8,
              human_acceptable: 0,
              automated_judge: 0.234,
            },
          },
        ],
      });
    },
  });
  const page = await service.getRun("admin", firstRun);
  assert.deepEqual(page.cases, [
    {
      id: "reviewed-row",
      messages: [{ role: "user", content: "Draw a square" }],
      before: null,
      after: source,
      outputSha256,
      review: synced,
    },
  ]);
});
