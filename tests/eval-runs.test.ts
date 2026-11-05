import assert from "node:assert/strict";
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
