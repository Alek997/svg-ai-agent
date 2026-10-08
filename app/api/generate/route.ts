import { generateSvg } from "@/lib/ai/generate-svg";
import { handleGeneration } from "@/lib/ai/handle-generation";
import { auth } from "@clerk/nextjs/server";

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
  return handleGeneration(request, (input, signal, progress, onEvent) =>
    generateSvg(input, signal, progress, undefined, onEvent),
  );
}
