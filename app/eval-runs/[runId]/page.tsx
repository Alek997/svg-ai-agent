import { auth } from "@clerk/nextjs/server";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ReviewArtwork } from "@/components/eval-review/review-artwork";
import { evalReview } from "@/lib/eval-review/access";
import { EvalReviewError } from "@/lib/eval-review/service";

export default async function EvalRunPage({
  params,
  searchParams,
}: {
  params: Promise<{ runId: string }>;
  searchParams: Promise<{ after?: string | string[] }>;
}) {
  const { runId } = await params;
  const { after } = await searchParams;
  const cursor = typeof after === "string" && after ? after : undefined;
  const { userId } = await auth();
  const page = await evalReview
    .getRun(userId, runId, cursor)
    .catch((error: unknown) => {
      if (error instanceof EvalReviewError && [403, 404].includes(error.status))
        notFound();
      return null;
    });
  const runPath = `/eval-runs/${encodeURIComponent(runId)}`;

  return (
    <main className="min-h-dvh bg-stone-50">
      <section className="mx-auto max-w-4xl px-5 py-8">
        <Link className="text-sm underline" href="/eval-runs" prefetch={false}>
          Back to Eval Runs
        </Link>
        <h1 className="mt-3 text-2xl font-semibold">Blind review</h1>
        {page ? (
          <>
            <div className="mt-6 space-y-5">
              {page.cases.map((item) => (
                <article
                  key={item.id}
                  className="rounded-xl border border-stone-200 bg-white p-4 sm:p-6"
                >
                  <h2 className="font-semibold">Request</h2>
                  <ol className="mt-2 space-y-2 text-sm text-stone-700">
                    {item.messages.map(({ role, content }, index) => (
                      <li
                        key={index}
                        className="whitespace-pre-wrap break-words"
                      >
                        {item.messages.length > 1 && (
                          <span className="font-medium capitalize">
                            {role} ·{" "}
                          </span>
                        )}
                        {content}
                      </li>
                    ))}
                  </ol>
                  <div className="mt-5 grid gap-4 sm:grid-cols-2">
                    {item.before && (
                      <ReviewArtwork label="Before" source={item.before} />
                    )}
                    <ReviewArtwork
                      label={item.before ? "After" : "Result"}
                      source={item.after}
                    />
                  </div>
                </article>
              ))}
              {!page.cases.length && (
                <p className="text-sm text-stone-600">
                  No completed outputs with valid artwork on this page.
                </p>
              )}
            </div>
            <nav aria-label="Review pages" className="mt-5 flex gap-5 text-sm">
              {cursor && (
                <Link className="underline" href={runPath} prefetch={false}>
                  First page
                </Link>
              )}
              {page.nextCursor && (
                <Link
                  className="underline"
                  href={{
                    pathname: runPath,
                    query: { after: page.nextCursor },
                  }}
                  prefetch={false}
                >
                  Next page
                </Link>
              )}
            </nav>
          </>
        ) : (
          <form action={runPath} className="mt-6 text-sm">
            {cursor && <input type="hidden" name="after" value={cursor} />}
            <p role="alert" className="text-red-700">
              Could not load this eval run.
            </p>
            <button className="mt-2 underline" type="submit">
              Retry
            </button>
          </form>
        )}
      </section>
    </main>
  );
}
