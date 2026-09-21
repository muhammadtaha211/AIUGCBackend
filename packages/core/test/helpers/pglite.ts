import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import type { Db } from "../../src/db";
import * as schema from "../../src/db/schema";

export const MIGRATIONS_DIR = fileURLToPath(
  new URL("../../../../supabase/migrations/", import.meta.url),
);

// 0002_supabase_rls.sql is deliberately absent: it references the Supabase
// auth schema, which only exists on Supabase. So are the later RLS files
// (0007, 0012, 0024, 0033, 0042) — 0033's policy names the `authenticated` role,
// which PGlite has no more than it has auth.uid(). 0035 is NOT one of them:
// a bare `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` names no role, so PGlite
// runs it (see facts/pglite-accepts-bare-enable-row-level-security) and the
// feedback table needs no policy at all.
export const PORTABLE_MIGRATIONS = [
  "0000_init.sql",
  "0001_extras_and_seed.sql",
  "0003_composites_and_images.sql",
  "0004_image_config_seed.sql",
  "0005_persona_images.sql",
  "0006_persona_images_default.sql",
  "0008_persona_gender.sql",
  "0009_persona_image_kind.sql",
  "0010_persona_images_retired.sql",
  "0011_credit_ledger_user.sql",
  "0013_demo_description_hook_personas.sql",
  "0014_persona_images_catalog.sql",
  "0015_persona_images_blur.sql",
  "0016_credit_ledger_unique_refs.sql",
  "0017_credit_costs_per_second.sql",
  "0018_per_account_caps.sql",
  "0019_usage_provider_heygen.sql",
  "0020_backfill_heygen_usage.sql",
  "0021_render_refund_provenance.sql",
  "0022_gpu_caps_account_first.sql",
  "0023_step_plans.sql",
  "0025_step_plan_notes.sql",
  "0026_a_steps_credits.sql",
  "0027_llm_caps_account_first.sql",
  "0028_split_legibility_gate.sql",
  "0029_plan_failure_diagnostics.sql",
  "0030_analysis_sections.sql",
  "0031_seed_unseeded_config.sql",
  "0032_opener_clips.sql",
  "0034_lipsync_expressiveness_medium.sql",
  "0035_feedback.sql",
  "0036_daily_caps_runaway_detector.sql",
  "0037_events_notified_at.sql",
  "0038_audio_preview_limit_50.sql",
  "0039_demo_analysis_credits.sql",
  "0040_audio_preview_cap_back_to_20.sql",
  "0041_subscriptions_keyed_on_user.sql",
  "0043_pricing_credit_unit.sql",
  "0044_plans_hebrew_names_sumit.sql",
  "0045_subscriptions_scheduled_plan_code.sql",
  "0046_terms_acceptances.sql",
  "0047_feedback_anonymous.sql",
  "0048_checkout_intents.sql",
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
