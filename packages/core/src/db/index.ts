import { drizzle } from "drizzle-orm/postgres-js";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import postgres from "postgres";
import { getEnv } from "../config";
import * as schema from "./schema";

export * as schema from "./schema";

/**
 * Driver-agnostic database handle. Production uses postgres-js against
 * Supabase; tests inject a PGlite-backed instance via setDb().
 */
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

let current: Db | undefined;
let client: postgres.Sql | undefined;

export function setDb(db: Db): void {
  current = db;
}

export function getDb(): Db {
  if (!current) {
    const url = getEnv().DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set (and no test db was injected via setDb)");
    // prepare:false keeps us compatible with Supabase's transaction pooler.
    client = postgres(url, { prepare: false });
    current = drizzle(client, { schema }) as unknown as Db;
  }
  return current;
}

export async function closeDb(): Promise<void> {
  await client?.end();
  client = undefined;
  current = undefined;
}
