import { publicSvgResponse } from "@/lib/svg/public-result";

export const runtime = "nodejs";
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  return publicSvgResponse(id);
}
