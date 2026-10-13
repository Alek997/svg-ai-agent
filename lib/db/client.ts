import "server-only";
import { Pool, neonConfig } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import ws from "ws";

// Pools must be closed within the serverless request that created them.
export async function withDatabase<T>(
  action: (db: ReturnType<typeof drizzle>) => Promise<T>,
): Promise<T> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("Database is not configured.");
  neonConfig.webSocketConstructor = ws;
  const pool = new Pool({ connectionString, connectionTimeoutMillis: 10_000 });
  try {
    return await action(drizzle(pool));
  } finally {
    await pool.end();
  }
}
