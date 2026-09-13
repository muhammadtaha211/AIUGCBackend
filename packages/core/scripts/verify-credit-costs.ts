/**
 * Read-back check for `app_config.credit_costs`, THROUGH the zod schema.
 *
 * Run it after applying `supabase/migrations/0039_demo_analysis_credits.sql`:
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
 * product can price; if it throws, steps, full, silent and Service B are all
 * down together.
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
import { creditCostsSchema, quoteServiceASteps, type CreditCosts } from "../src/pricing";

/** What 0017 seeded and 0039 amended. The two 0039 touched are marked. */
const EXPECTED: CreditCosts = {
  a_assembly_flat: 3,
  a_demo_per_second: 0.15,
  a_outro_per_second: 1,
  a_minimum_credits: 5,
  b_per_second: 1,
  b_minimum_credits: 0,
  a_ending_reroll_per_second: 1,
  a_remix_assembly_credits: 2,
  a_steps_credits: 3, // 0039: was 5
  a_demo_analysis_credits: 2, // 0039: new
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

  // 2. jsonb TYPES and the key count: a hand-pasted '"3"' passes every value
  //    check above only if it was coerced, and a stray key means the row was
  //    edited by hand (the strip hides it from the code, not from this).
  const row = (
    await db.select().from(appConfig).where(eq(appConfig.key, "credit_costs")).limit(1)
  )[0];
  const value = (row?.value ?? {}) as Record<string, unknown>;
  check("row exists", row !== undefined, row !== undefined);
  check(
    "exactly the 10 known keys, nothing stray",
    Object.keys(value).sort().join(",") === Object.keys(EXPECTED).sort().join(","),
    Object.keys(value).sort(),
  );
  const typed = await db.execute(
    sql`select jsonb_typeof(value -> 'a_steps_credits') as steps,
               jsonb_typeof(value -> 'a_demo_analysis_credits') as analysis
        from app_config where key = 'credit_costs'`,
  );
  const types = (Array.isArray(typed) ? typed : ((typed as { rows?: unknown[] }).rows ?? []))[0] as
    { steps: string; analysis: string } | undefined;
  check(
    "both 0039 keys are jsonb numbers, not strings",
    types?.steps === "number" && types?.analysis === "number",
    types,
  );

  // 3. What a customer is actually quoted, from the live row.
  const reused = quoteServiceASteps({ costs, firstPaidRenderOfDemo: false });
  const fresh = quoteServiceASteps({ costs, firstPaidRenderOfDemo: true });
  check("a reused demo quotes 3", reused.credits === 3, reused.credits);
  check("a demo's first paid render quotes 5", fresh.credits === 5, fresh.credits);
  check(
    "the 5 itemises as steps 3 + analysis 2",
    JSON.stringify(fresh.components) ===
      JSON.stringify([
        { kind: "steps", credits: 3 },
        { kind: "analysis", credits: 2 },
      ]),
    fresh.components,
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
