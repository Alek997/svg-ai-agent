import "server-only";
import { z } from "zod";
import { safeSvgSchema } from "@/lib/svg/validate-svg";
import { generationRequestSchema } from "@/lib/workspace/contracts";
import { saveReviewSchema } from "./contracts";
import {
  encodeHumanReview,
  latestReviewFeedback,
  outputHash,
  readHumanReview,
} from "./ratings";

const runPageSize = 10;
const maxPageReads = 5;
const idSchema = z.uuid();
const projectSchema = z.object({ id: idSchema, name: z.string() });
const experimentSchema = z.object({
  id: idSchema,
  project_id: idSchema,
  name: z.string(),
  created: z.iso.datetime({ offset: true }).nullish(),
});
const experimentListSchema = z.object({ objects: z.array(experimentSchema) });
const cursorSchema = z.string().min(1).max(2048);
const eventPageSchema = z.object({
  events: z.array(z.unknown()),
  cursor: cursorSchema.nullish(),
});
const btqlPageSchema = z.object({
  data: z.array(z.unknown()),
  cursor: cursorSchema.nullish(),
});
const rowIdentitySchema = z.object({ id: z.string().min(1).max(200) });
const eventSchema = z.object({
  ...rowIdentitySchema.shape,
  experiment_id: idSchema,
  span_parents: z.array(z.string()).nullish(),
  is_root: z.boolean().nullish(),
  error: z.unknown().optional(),
  input: z.object({ input: generationRequestSchema }),
  output: z.object({ status: z.literal("completed"), source: z.string() }),
});

function toReviewCase(value: unknown, runId: string) {
  const event = eventSchema.safeParse(value);
  if (!event.success) return [];
  const row = event.data;
  if (
    row.experiment_id !== runId ||
    row.is_root === false ||
    row.span_parents?.length ||
    row.error != null
  )
    return [];

  const { messages, currentSvg } = row.input.input;
  const after = safeSvgSchema.safeParse(row.output.source);
  const before =
    currentSvg === undefined ? null : safeSvgSchema.safeParse(currentSvg);
  if (!after.success || before?.success === false) return [];
  return [
    {
      id: row.id,
      messages,
      before: before?.data.source ?? null,
      after: after.data.source,
      outputSha256: outputHash(row.output.source),
    },
  ];
}

export class EvalReviewError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export function createEvalReview(options: {
  authorize: (userId: string) => Promise<boolean>;
  project: string;
  apiKey?: string;
  fetch?: typeof fetch;
}) {
  async function requireAccess(userId: string | null) {
    if (!userId || !(await options.authorize(userId))) {
      throw new EvalReviewError(
        403,
        "Eval review is unavailable for this account.",
      );
    }
    return userId;
  }

  async function request(
    path: string,
    optionsForRequest: { query?: URLSearchParams; body?: object },
  ) {
    if (!options.apiKey)
      throw new EvalReviewError(503, "Braintrust is not configured.");
    const url = new URL(path, "https://api.braintrust.dev");
    const { query, body } = optionsForRequest;
    if (query) url.search = query.toString();
    const response = await (options.fetch ?? fetch)(url, {
      method: body ? "POST" : "GET",
      headers: {
        Authorization: `Bearer ${options.apiKey}`,
        ...(body && { "Content-Type": "application/json" }),
      },
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      if (response.status === 429)
        throw new EvalReviewError(
          429,
          "Braintrust is busy. Try again in a moment.",
        );
      throw new EvalReviewError(
        502,
        "Braintrust could not complete the request.",
      );
    }
    return response;
  }

  async function requestJson(
    path: string,
    optionsForRequest: { query?: URLSearchParams; body?: object },
  ) {
    return (await (await request(path, optionsForRequest)).json()) as unknown;
  }

  async function resolveProjectId() {
    const params = new URLSearchParams({
      project_name: options.project,
      limit: "2",
    });
    const { objects } = z
      .object({ objects: z.array(projectSchema) })
      .parse(await requestJson("/v1/project", { query: params }));
    const projects = objects.filter(({ name }) => name === options.project);
    if (projects.length !== 1) {
      throw new EvalReviewError(
        503,
        "The configured Braintrust project could not be identified.",
      );
    }
    return projects[0].id;
  }

  async function requireRun(runId: string) {
    const notFound = new EvalReviewError(404, "Eval run not found.");
    if (!idSchema.safeParse(runId).success) throw notFound;
    const projectId = await resolveProjectId();
    const { objects } = experimentListSchema.parse(
      await requestJson("/v1/experiment", {
        query: new URLSearchParams({ project_id: projectId, ids: runId }),
      }),
    );
    if (
      !objects.some((run) => run.id === runId && run.project_id === projectId)
    )
      throw notFound;
  }

  async function queryRunRows(
    runId: string,
    ids: string[],
    mode: "current" | "feedback",
    cursor?: string,
  ) {
    const auditLog = mode === "feedback";
    const result = await request("/btql", {
      body: {
        query: {
          select: auditLog
            ? ["id", "_xact_id", "audit_data"].map((name) => ({
                op: "ident",
                name: [name],
              }))
            : [{ op: "star" }],
          from: {
            op: "function",
            name: { op: "ident", name: ["experiment"] },
            args: [{ op: "literal", value: runId }],
          },
          filter: {
            op: "in",
            left: { op: "ident", name: ["id"] },
            right: { op: "literal", value: ids },
          },
          limit: auditLog ? 200 : ids.length + 1,
          cursor,
        },
        audit_log: auditLog,
        use_columnstore: false,
        brainstore_realtime: true,
      },
    });
    const page = btqlPageSchema.parse(await result.json());
    return {
      data: page.data,
      cursor:
        page.cursor ??
        cursorSchema.safeParse(result.headers.get("x-bt-cursor")).data,
    };
  }

  async function readReviewFeedback(runId: string, ids: string[]) {
    const rows: unknown[] = [];
    const seen = new Set<string>();
    let cursor: string | undefined;
    for (let index = 0; index < maxPageReads; index++) {
      const page = await queryRunRows(runId, ids, "feedback", cursor);
      rows.push(...page.data);
      if (!page.cursor || !page.data.length) return latestReviewFeedback(rows);
      if (seen.has(page.cursor)) break;
      seen.add(page.cursor);
      cursor = page.cursor;
    }
    throw new EvalReviewError(
      502,
      "Could not finish loading the review history.",
    );
  }

  async function fetchReviewPage(runId: string, after?: string) {
    let cursor = cursorSchema.safeParse(after).data ?? null;
    const seen = new Set(cursor ? [cursor] : []);
    for (let index = 0; index < maxPageReads; index++) {
      const page = eventPageSchema.parse(
        await requestJson(`/v1/experiment/${runId}/fetch`, {
          body: { limit: 10, cursor: cursor ?? undefined },
        }),
      );
      const cases = page.events.flatMap((event) => toReviewCase(event, runId));
      const nextCursor =
        page.cursor && !seen.has(page.cursor) && page.events.length
          ? page.cursor
          : null;
      if (cases.length || !nextCursor) return { cases, nextCursor };
      // A provider page may consist entirely of failed or non-reviewable rows.
      seen.add(nextCursor);
      cursor = nextCursor;
    }
    return { cases: [], nextCursor: cursor };
  }

  return {
    async listRuns(userId: string | null, after?: string) {
      await requireAccess(userId);
      const projectId = await resolveProjectId();
      const params = new URLSearchParams({
        project_id: projectId,
        limit: String(runPageSize + 1),
      });
      const cursor = idSchema.safeParse(after);
      if (cursor.success) params.set("starting_after", cursor.data);
      const { objects } = experimentListSchema.parse(
        await requestJson("/v1/experiment", { query: params }),
      );
      // Braintrust returns newest first. Keep provider order for its cursor.
      const page = objects.slice(0, runPageSize);
      const runs = page
        .filter((experiment) => experiment.project_id === projectId)
        .map(({ id, name, created }) => ({
          id,
          name,
          created: created ?? null,
        }));
      return {
        runs,
        isOlderPage: cursor.success,
        nextCursor: objects.length > runPageSize ? page.at(-1)?.id : undefined,
      };
    },
    async getRun(userId: string | null, runId: string, after?: string) {
      await requireAccess(userId);
      await requireRun(runId);

      const { cases, nextCursor } = await fetchReviewPage(runId, after);
      const feedback = cases.length
        ? await readReviewFeedback(
            runId,
            cases.map(({ id }) => id),
          )
        : null;
      return {
        cases: cases.map((item) => ({
          ...item,
          review: readHumanReview(item.outputSha256, feedback?.get(item.id)),
        })),
        nextCursor,
      };
    },
    async saveReview(userId: string | null, runId: string, input: unknown) {
      const reviewer = await requireAccess(userId);
      const payload = saveReviewSchema.safeParse(input);
      if (!payload.success)
        throw new EvalReviewError(400, "The review fields are invalid.");
      await requireRun(runId);
      const { id, outputSha256, rating } = payload.data;
      const { data: rows } = await queryRunRows(runId, [id], "current");
      const matches = rows.filter(
        (row) => rowIdentitySchema.safeParse(row).data?.id === id,
      );
      const [item] =
        matches.length === 1 ? toReviewCase(matches[0], runId) : [];
      if (!item)
        throw new EvalReviewError(
          404,
          "This output is unavailable for review.",
        );
      if (item.outputSha256 !== outputSha256)
        throw new EvalReviewError(
          409,
          "The artwork changed. Reload the run before scoring it.",
        );

      const review = { ...rating, reviewer };
      z.object({ status: z.literal("success") }).parse(
        await requestJson(`/v1/experiment/${runId}/feedback`, {
          body: {
            feedback: [
              {
                id,
                ...encodeHumanReview(review, outputSha256),
                source: "external",
              },
            ],
          },
        }),
      );
      return review;
    },
  };
}
