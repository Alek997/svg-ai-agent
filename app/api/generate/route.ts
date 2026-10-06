import { generateSvg } from "@/lib/ai/generate-svg";
import { handleGeneration } from "@/lib/ai/handle-generation";

export const runtime = "nodejs";
export const maxDuration = 65;

export async function POST(request: Request) {
  return handleGeneration(request, generateSvg);
}
