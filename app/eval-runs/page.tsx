import { auth } from "@clerk/nextjs/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { WorkspaceHeader } from "@/components/workspace/workspace-header";
import { evalReview } from "@/lib/eval-review/access";
import { EvalReviewError } from "@/lib/eval-review/service";

export default async function EvalRunsPage({
  searchParams,
}: {
  searchParams: Promise<{ after?: string | string[] }>;
}) {
  const { after } = await searchParams;
  const { userId } = await auth();
  const page = await evalReview
    .listRuns(userId, typeof after === "string" ? after : undefined)
    .catch((error: unknown) => {
      if (error instanceof EvalReviewError && error.status === 403) notFound();
      return null;
    });

  return (
    <main className="min-h-dvh bg-stone-50">
      <WorkspaceHeader />
      <section className="mx-auto max-w-4xl px-5 py-8">
        <h2 className="text-2xl font-semibold">Eval Runs</h2>
        <p className="mt-1 text-sm text-stone-600">
          Uploaded experiments from Braintrust.
        </p>
        {page ? (
          <>
            <ul className="mt-6 divide-y divide-stone-200 rounded-xl border border-stone-200 bg-white">
              {page.runs.map((run) => (
                <li key={run.id} className="px-4 py-3">
                  {/* Use a new document so the directory's run names leave the page payload. */}
                  <a
                    className="block font-medium underline-offset-4 hover:underline"
                    href={`/eval-runs/${run.id}`}
                  >
                    {run.name}
                  </a>
                  {run.created ? (
                    <time
                      dateTime={run.created}
                      className="text-sm text-stone-600"
                    >
                      {new Date(run.created).toISOString().slice(0, 10)}
                    </time>
                  ) : (
                    <p className="text-sm text-stone-600">Date unavailable</p>
                  )}
                  <p className="mt-1 text-sm text-stone-600">
                    {run.progress
                      ? `${run.progress.rated} of ${run.progress.completed} rated · ${run.progress.skipped} skipped`
                      : "Review progress unavailable"}
                  </p>
                </li>
              ))}
              {!page.runs.length && (
                <li className="p-4 text-sm text-stone-600">
                  No uploaded runs found.
                </li>
              )}
            </ul>
            {page.nextCursor && (
              <Link
                className="mt-4 inline-block text-sm underline"
                href={`?after=${page.nextCursor}`}
                prefetch={false}
              >
                Older runs
              </Link>
            )}
            {page.isOlderPage && (
              <Link
                className="mt-4 ml-4 inline-block text-sm underline"
                href="/eval-runs"
                prefetch={false}
              >
                Newest runs
              </Link>
            )}
          </>
        ) : (
          <p role="alert" className="mt-6 text-sm text-red-700">
            Could not load eval runs.{" "}
            <Link className="underline" href="/eval-runs" prefetch={false}>
              Reload Eval Runs
            </Link>
            .
          </p>
        )}
      </section>
    </main>
  );
}
