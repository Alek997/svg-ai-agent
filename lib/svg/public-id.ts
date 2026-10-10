import { z } from "zod";

// Twelve URL-safe characters, generated once by PostgreSQL and unique per result.
export const publicIdSchema = z.string().regex(/^[A-Za-z0-9_-]{12}$/);
export const publicSvgIdSchema = z.union([publicIdSchema, z.string().uuid()]);
