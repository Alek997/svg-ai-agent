import "server-only";
import { and, eq, sql, type SQL } from "drizzle-orm";
import { withDatabase } from "../db/client";
import { svgResults, messages, conversations } from "../db/schema";
import { safeSvgSchema } from "./validate-svg";
import { publicIdSchema, publicSvgIdSchema } from "./public-id";

type Database = Parameters<Parameters<typeof withDatabase>[0]>[0];

function publicResult(
  db: Database,
  value: SQL<string> | typeof svgResults.publicId,
  match: SQL,
) {
  return db
    .select({ value })
    .from(svgResults)
    .innerJoin(messages, eq(messages.id, svgResults.assistantMessageId))
    .innerJoin(conversations, eq(conversations.id, messages.conversationId))
    .where(and(eq(conversations.private, false), match))
    .limit(1);
}

// Select only markup: never load prompts, owners, descriptions or model metadata.
export async function readPublicSvg(
  id: string,
  runDatabase = withDatabase,
): Promise<unknown | null> {
  return runDatabase(async (db) => {
    const [row] = await publicResult(
      db,
      sql<string>`${svgResults.document}->>'source'`,
      publicIdSchema.safeParse(id).success
        ? eq(svgResults.publicId, id)
        : eq(svgResults.id, id),
    );
    return row?.value ?? null;
  });
}

// Legacy page links redirect without reading any conversation or user metadata.
export async function resolvePublicId(
  id: string,
  runDatabase = withDatabase,
): Promise<string | null> {
  return runDatabase(async (db) => {
    const [row] = await publicResult(
      db,
      svgResults.publicId,
      eq(svgResults.id, id),
    );
    return row?.value ?? null;
  });
}

const headers = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex, nofollow",
  "Content-Security-Policy": "default-src 'none'; sandbox",
};

export async function publicSvgResponse(
  id: string,
  read = readPublicSvg,
): Promise<Response> {
  const unavailable = () =>
    new Response("SVG unavailable.", { status: 404, headers });
  if (!publicSvgIdSchema.safeParse(id).success) return unavailable();
  try {
    const source = await read(id);
    if (source === null) return unavailable();
    const validated = safeSvgSchema.safeParse(source);
    if (!validated.success) return unavailable();
    return new Response(validated.data.source, {
      headers: {
        ...headers,
        "Content-Type": "image/svg+xml; charset=utf-8",
        "Content-Disposition": 'inline; filename="artwork.svg"',
      },
    });
  } catch {
    return new Response("SVG could not be loaded. Please try again.", {
      status: 503,
      headers,
    });
  }
}
