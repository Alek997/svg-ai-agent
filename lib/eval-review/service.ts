import "server-only";
import { z } from "zod";

const runPageSize = 10;
const idSchema = z.uuid();
const projectSchema = z.object({ id: idSchema, name: z.string() });
const experimentSchema = z.object({
  id: idSchema,
  project_id: idSchema,
  name: z.string(),
  created: z.iso.datetime({ offset: true }).nullish(),
});

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

  async function request(path: string, params: URLSearchParams) {
    if (!options.apiKey)
      throw new EvalReviewError(503, "Braintrust is not configured.");
    const url = new URL(path, "https://api.braintrust.dev");
    url.search = params.toString();
    const response = await (options.fetch ?? fetch)(url, {
      headers: {
        Authorization: `Bearer ${options.apiKey}`,
      },
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
      .parse(await request("/v1/project", params));
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
      const { objects } = z
        .object({ objects: z.array(experimentSchema) })
        .parse(await request("/v1/experiment", params));
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
  };
}
