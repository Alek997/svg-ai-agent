import { generateSvg } from "@/lib/ai/generate-svg";
import { handleGeneration } from "@/lib/ai/handle-generation";
import { auth } from "@clerk/nextjs/server";

export const runtime = "nodejs";
export const maxDuration = 65;

export async function POST(request: Request) {
  const { userId } = await auth();
  if (!userId) {
    return Response.json(
      { error: "Please sign in before generating an SVG." },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }
  return handleGeneration(request, generateSvg);
}
