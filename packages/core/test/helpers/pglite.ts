import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import type { Db } from "../../src/db";
import * as schema from "../../src/db/schema";

const MIGRATIONS_DIR = fileURLToPath(new URL("../../../../supabase/migrations/", import.meta.url));

// 0002_supabase_rls.sql is deliberately absent: it references the Supabase
// auth schema, which only exists on Supabase.
const PORTABLE_MIGRATIONS = [
  "0000_init.sql",
  "0001_extras_and_seed.sql",
  "0003_composites_and_images.sql",
  "0004_image_config_seed.sql",
  "0005_persona_images.sql",
  "0006_persona_images_default.sql",
];

/** In-process real Postgres (PGlite) with the portable migrations applied. */
export async function createTestDb(): Promise<{ db: Db; pg: PGlite }> {
  const pg = new PGlite();
  for (const file of PORTABLE_MIGRATIONS) {
    await pg.exec(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
  }
  const db = drizzle(pg, { schema }) as unknown as Db;
  return { db, pg };
}
