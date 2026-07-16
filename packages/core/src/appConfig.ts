import { eq } from "drizzle-orm";
import type { z } from "zod";
import type { Db } from "./db";
import { appConfig } from "./db/schema";

/** Read a runtime knob seeded by supabase/migrations/0001_extras_and_seed.sql. */
export async function getConfigValue<T>(db: Db, key: string, schema: z.ZodType<T>): Promise<T> {
  const rows = await db.select().from(appConfig).where(eq(appConfig.key, key)).limit(1);
  if (!rows[0]) throw new Error(`app_config row "${key}" is missing (seed not applied?)`);
  return schema.parse(rows[0].value);
}
