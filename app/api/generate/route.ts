import { searchCollection, retrievalQuery } from "@/lib/collections/retrieval";
import { generateSvg } from "@/lib/ai/generate-svg";
import { handleSavedGeneration } from "@/lib/conversations/generate";
import { auth } from "@clerk/nextjs/server";
import { after } from "next/server";
import { flushTracking, startGenerationTracking } from "@/lib/ai/tracking";

export const runtime = "nodejs";
// Statically analyzable by Next.js; within Vercel Hobby's 300-second ceiling.
export const maxDuration = 300;

export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return Response.json(
      { error: "Please sign in before generating an SVG." },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }
  after(flushTracking);
  return handleSavedGeneration(request, userId, (input, signal, progress, onEvent) =>
    generateSvg(input, signal, progress, undefined, onEvent),
    { observe: input => startGenerationTracking(input, userId),
      retrieve: (run, input, signal) => searchCollection(userId, run.collectionId!, retrievalQuery(run.initialRequest!, input.messages.at(-1)!.content), signal, run.assistantMessageId),
      generateWithReferences: (input, signal, progress, event, detail) => generateSvg(input, signal, progress, undefined, event, undefined, detail),
    },
  );
}
