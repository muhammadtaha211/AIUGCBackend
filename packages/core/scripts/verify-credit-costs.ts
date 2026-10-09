/**
 * Read-back check for `app_config.credit_costs`, THROUGH the zod schema.
 *
 * Run it after applying `supabase/migrations/0053_text_block_credits.sql` (it
 * was written for 0043, and 0053 added the eleventh key):
 *
 *   apps/cli/node_modules/.bin/tsx packages/core/scripts/verify-credit-costs.ts
 *
 * Why through the schema and not a raw `SELECT`: nothing validates writes to
 * `app_config`, and `creditCostsSchema` (packages/core/src/pricing.ts) is a
 * plain `z.object` — strip mode. A mistyped or misplaced key survives in the
 * row forever and the code simply never sees it, so the row can look changed
 * while the price has not moved. That has already happened once, which is why
 * `0028_split_legibility_gate.sql` exists. `getConfigValue` is the exact call
 * `quoteContext` makes on every quote path, so if this script passes, the
 * product can price; if it throws, steps, full, silent, Service B, Service C
 * and /pricing are all down together.
 *
 * The type checks are not belt-and-braces. `'"3"'` — a JSON string — satisfies
 * `->>` and any text comparison, and then throws at the next customer quote
 * instead of here. Only `jsonb_typeof` catches it before a customer does.
 *
 * STRICTLY READ-ONLY. Exits 0 on PASS, 1 on any failure.
 */
import { readFileSync } from "node:fs";
import { eq, sql } from "drizzle-orm";
import { resetEnvCache } from "../src/config";
import { getConfigValue } from "../src/appConfig";
import { closeDb, getDb } from "../src/db";
import { appConfig } from "../src/db/schema";
import {
  creditCostsSchema,
  quoteServiceASteps,
  quoteServiceB,
  quoteServiceC,
  type CreditCosts,
} from "../src/pricing";

/**
 * The row as 0053 left it: 0043's ten keys untouched, plus Service C's flat.
 * The ten as 0043 left them: all re-based on the ₪0.15 credit
 * (2026-09-17). Seven are a straight x5 of what 0017 seeded and 0026/0039
 * amended; three are not, and those three are the whole point of 0043 --
 * b_minimum_credits went 0 -> 75 (a Service B floor where there was none),
 * a_steps_credits 3 -> 25 (x8.33) and a_demo_analysis_credits 2 -> 20 (x10),
 * a real-terms price rise on the two live Service A charges.
 */
const EXPECTED: CreditCosts = {
  a_assembly_flat: 15,
  a_demo_per_second: 0.75,
  a_outro_per_second: 5,
  a_minimum_credits: 25,
  b_per_second: 5,
  b_minimum_credits: 75, // 0043: was 0, i.e. inactive
  a_ending_reroll_per_second: 5,
  a_remix_assembly_credits: 10,
  a_steps_credits: 25, // 0026: 5 -> 0039: 3 -> 0043: 25
  a_demo_analysis_credits: 20, // 0039: new at 2 -> 0043: 20
  c_text_block_credits: 25, // 0053: new, the founder's flat for one גוש טקסט render (0089 §4)
};

/**
 * The connection string is read out of the env file HERE, inside the script
 * that uses it — never typed onto a command line, never printed, not even on
 * failure (CLAUDE.md, the credential rule).
 */
function loadDatabaseUrl(): void {
  if (process.env.DATABASE_URL) return;
  const envPath = new URL("../../../.env", import.meta.url);
  let raw: string;
  try {
    raw = readFileSync(envPath, "utf8");
  } catch {
    throw new Error("DATABASE_URL is not set and .env could not be read at the repo root");
  }
  for (const line of raw.split(/\r?\n/)) {
    const match = /^\s*DATABASE_URL\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    process.env.DATABASE_URL = match[1]!.trim().replace(/^["']|["']$/g, "");
    resetEnvCache();
    return;
  }
  throw new Error("no DATABASE_URL line in the repo-root .env");
}

const failures: string[] = [];
function check(name: string, ok: boolean, got: unknown): void {
  console.log(`${ok ? "ok  " : "FAIL"} ${name} :: ${JSON.stringify(got)}`);
  if (!ok) failures.push(name);
}

async function main(): Promise<number> {
  loadDatabaseUrl();
  const db = getDb();

  // 1. The parse every quote path performs. Throws if a key is missing.
  const costs = await getConfigValue(db, "credit_costs", creditCostsSchema);
  for (const [key, want] of Object.entries(EXPECTED) as [keyof CreditCosts, number][]) {
    check(key, costs[key] === want, costs[key]);
  }

  // 2. jsonb TYPES and the key count: a hand-pasted '"25"' passes every value
  //    check above only if it was coerced, and a stray key means the row was
  //    edited by hand (the strip hides it from the code, not from this).
  const row = (
    await db.select().from(appConfig).where(eq(appConfig.key, "credit_costs")).limit(1)
  )[0];
  const value = (row?.value ?? {}) as Record<string, unknown>;
  check("row exists", row !== undefined, row !== undefined);
  check(
    "exactly the 11 known keys, nothing stray",
    Object.keys(value).sort().join(",") === Object.keys(EXPECTED).sort().join(","),
    Object.keys(value).sort(),
  );
  const typed = await db.execute(
    sql`select count(*)::int as n from app_config c, jsonb_each(c.value) v
        where c.key = 'credit_costs' and jsonb_typeof(v.value) <> 'number'`,
  );
  const types = (Array.isArray(typed) ? typed : ((typed as { rows?: unknown[] }).rows ?? []))[0] as
    { n: number } | undefined;
  check("all eleven values are jsonb numbers, not strings", types?.n === 0, types);

  // 3. What a customer is actually quoted, from the live row.
  const reused = quoteServiceASteps({ costs, firstPaidRenderOfDemo: false });
  const fresh = quoteServiceASteps({ costs, firstPaidRenderOfDemo: true });
  check("a reused demo quotes 25", reused.credits === 25, reused.credits);
  check("a demo's first paid render quotes 45", fresh.credits === 45, fresh.credits);
  check(
    "the 45 itemises as steps 25 + analysis 20",
    JSON.stringify(fresh.components) ===
      JSON.stringify([
        { kind: "steps", credits: 25 },
        { kind: "analysis", credits: 20 },
      ]),
    fresh.components,
  );

  // 4. The one behaviour 0043 ADDS rather than re-denominates: a Service B
  //    floor. An inactive floor becoming active is invisible to every
  //    per-key check above, because the key was already present at 0.
  const b20 = quoteServiceB({ durationMs: 20_000, costs });
  const b8 = quoteServiceB({ durationMs: 8_000, costs });
  check("20s of approved VO quotes 100", b20.credits === 100 && !b20.minimumApplied, b20.credits);
  check("8s hits the 75 floor", b8.credits === 75 && b8.minimumApplied, b8.credits);

  // 5. The key 0053 ADDS: one Service C render, flat and floor-exempt.
  const c = quoteServiceC({ costs });
  check(
    "a גוש טקסט render quotes 25, with no floor",
    c.credits === 25 && !c.minimumApplied,
    c.credits,
  );
  check(
    "the 25 itemises as one text_block flat",
    JSON.stringify(c.components) === JSON.stringify([{ kind: "text_block", credits: 25 }]),
    c.components,
  );

  console.log(failures.length === 0 ? "\nPASS" : `\nFAIL: ${failures.join(", ")}`);
  return failures.length === 0 ? 0 : 1;
}

main()
  .then(async (code) => {
    await closeDb();
    process.exitCode = code;
  })
  .catch(async (err: unknown) => {
    // Never print the error object raw: a postgres-js connection error can
    // carry the connection string.
    console.error(`FAIL: ${err instanceof Error ? err.message : "unknown error"}`);
    await closeDb();
    process.exitCode = 1;
  });
