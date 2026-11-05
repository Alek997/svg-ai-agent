import "server-only";
import { z } from "zod";
import { safeSvgSchema } from "@/lib/svg/validate-svg";
import { generationRequestSchema } from "@/lib/workspace/contracts";

const runPageSize = 10;
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
const eventSchema = z.object({
  id: z.string().min(1),
  experiment_id: idSchema,
  span_parents: z.array(z.string()).nullish(),
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
    return (await response.json()) as unknown;
  }

  async function resolveProjectId() {
    const params = new URLSearchParams({
      project_name: options.project,
      limit: "2",
    });
    const { objects } = z
      .object({ objects: z.array(projectSchema) })
      .parse(await request("/v1/project", { query: params }));
    const projects = objects.filter(({ name }) => name === options.project);
    if (projects.length !== 1) {
      throw new EvalReviewError(
        503,
        "The configured Braintrust project could not be identified.",
      );
    }
    return projects[0].id;
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
        await request("/v1/experiment", { query: params }),
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
      const notFound = new EvalReviewError(404, "Eval run not found.");
      if (!idSchema.safeParse(runId).success) throw notFound;

      const projectId = await resolveProjectId();
      const { objects } = experimentListSchema.parse(
        await request("/v1/experiment", {
          query: new URLSearchParams({ project_id: projectId, ids: runId }),
        }),
      );
      if (
        !objects.some((run) => run.id === runId && run.project_id === projectId)
      )
        throw notFound;

      const cursor = cursorSchema.safeParse(after);
      const page = eventPageSchema.parse(
        await request(`/v1/experiment/${runId}/fetch`, {
          body: { limit: 10, cursor: cursor.data },
        }),
      );
      return {
        cases: page.events.flatMap((event) => toReviewCase(event, runId)),
        nextCursor:
          page.cursor === after || !page.events.length
            ? null
            : (page.cursor ?? null),
      };
    },
  };
}
