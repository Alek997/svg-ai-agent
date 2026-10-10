import "server-only";
import { eq, sql } from "drizzle-orm";
import { withDatabase } from "../db/client";
import { svgResults } from "../db/schema";
import { safeSvgSchema } from "./validate-svg";
import { publicIdSchema, publicSvgIdSchema } from "./public-id";

// Select only markup: never load prompts, owners, descriptions or model metadata.
export async function readPublicSvg(id: string, runDatabase = withDatabase): Promise<unknown | null> {
  return runDatabase(async db => {
    const [row] = await db.select({ source: sql<string>`${svgResults.document}->>'source'` })
      .from(svgResults).where(publicIdSchema.safeParse(id).success ? eq(svgResults.publicId, id) : eq(svgResults.id, id)).limit(1);
    return row?.source ?? null;
  });
}

// Legacy page links redirect without reading any conversation or user metadata.
export async function resolvePublicId(id: string, runDatabase = withDatabase): Promise<string | null> {
  return runDatabase(async db => {
    const [row] = await db.select({ publicId: svgResults.publicId }).from(svgResults).where(eq(svgResults.id, id)).limit(1);
    return row?.publicId ?? null;
  });
}

const headers = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex, nofollow",
  "Content-Security-Policy": "default-src 'none'; sandbox",
};

export async function publicSvgResponse(id: string, read = readPublicSvg): Promise<Response> {
  const unavailable = () => new Response("SVG unavailable.", { status: 404, headers });
  if (!publicSvgIdSchema.safeParse(id).success) return unavailable();
  try {
    const source = await read(id);
    if (source === null) return unavailable();
    const validated = safeSvgSchema.safeParse(source);
    if (!validated.success) return unavailable();
    return new Response(validated.data.source, {
      headers: { ...headers, "Content-Type": "image/svg+xml; charset=utf-8", "Content-Disposition": 'inline; filename="artwork.svg"' },
    });
  } catch {
    return new Response("SVG could not be loaded. Please try again.", { status: 503, headers });
  }
}
