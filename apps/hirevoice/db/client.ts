import { createClient, type Client } from "@libsql/client";

let cached: Client | undefined;

/** Lazily build a libsql client from env. Reused across handler invocations. */
export function getDb(): Client {
  if (cached) return cached;
  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;
  if (!url) throw new Error("TURSO_DATABASE_URL is not set");
  cached = createClient({ url, authToken });
  return cached;
}
