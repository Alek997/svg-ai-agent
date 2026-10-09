import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

const lifetimeMs = 7 * 24 * 60 * 60 * 1000;
const payloadSchema = z.object({ id: z.string().uuid(), issuedAt: z.number().int() }).strict();

function signature(payload: string, userId: string, secret: string) {
  return createHmac("sha256", secret).update(JSON.stringify(["svg-feedback-v1", userId, payload])).digest();
}

// Ownership is signed server-side: a span ID alone is never permission to rate it.
export function createFeedbackToken(id: string, userId: string, secret: string, now = Date.now()) {
  const payload = Buffer.from(JSON.stringify({ id, issuedAt: now })).toString("base64url");
  return `${payload}.${signature(payload, userId, secret).toString("base64url")}`;
}

export function verifyFeedbackToken(token: string, userId: string, secret: string, now = Date.now()) {
  try {
    if (token.length > 1000) return null;
    const parts = token.split(".");
    if (parts.length !== 2) return null;
    const [payload, signed] = parts;
    const supplied = Buffer.from(signed, "base64url");
    const expected = signature(payload, userId, secret);
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null;
    const parsed = payloadSchema.safeParse(JSON.parse(Buffer.from(payload, "base64url").toString()));
    if (!parsed.success || parsed.data.issuedAt > now || now - parsed.data.issuedAt > lifetimeMs) return null;
    return parsed.data.id;
  } catch { return null; }
}
