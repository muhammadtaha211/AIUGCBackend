/**
 * Read-back check for `app_config.daily_caps`, THROUGH the zod schema.
 *
 * Run it after applying `supabase/migrations/0036_daily_caps_runaway_detector.sql`:
 *
 *   apps/cli/node_modules/.bin/tsx packages/core/scripts/verify-daily-caps.ts
 *
 * Why through the schema and not a raw `SELECT`: nothing validates writes to
 * `app_config`, and `dailyCapsSchema` (packages/core/src/config.ts:39-54) is a
 * plain `z.object` at BOTH levels — strip mode. An unknown or mistyped key
 * survives in the row forever and the code simply never sees it, so the row can
 * look changed while the cap has not moved
 * (docs/vault/facts/token-and-money-budgets.md). This reads the row, parses it
 * the way the product does, and compares all seven values — and separately
 * reports any key the schema stripped, which is the failure a `SELECT` hides.
 *
 * "The UPDATE succeeded" is not a verification. This is.
 *
 * READ-ONLY: one SELECT. It writes nothing.
 */
import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { dailyCapsSchema, resetEnvCache } from "../src/config";
import { closeDb, getDb } from "../src/db";
import { appConfig } from "../src/db/schema";

/** What 0036 sets. Every platform cap is 16x its per_account pair. */
const EXPECTED = {
  images: 400,
  tts_chars: 400_000,
  llm_tokens: 8_000_000,
  gpu_seconds: 32_000,
  per_account: { tts_chars: 25_000, llm_tokens: 500_000, gpu_seconds: 2_000 },
} as const;

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

function main(): Promise<number> {
  loadDatabaseUrl();
  const db = getDb();
  return db
    .select()
    .from(appConfig)
    .where(eq(appConfig.key, "daily_caps"))
    .limit(1)
    .then((rows) => {
      const row = rows[0];
      if (!row) {
        console.error("FAIL: app_config has no 'daily_caps' row at all.");
        return 1;
      }

      const caps = dailyCapsSchema.parse(row.value);
      const checks: [string, number, number][] = [
        ["images", caps.images, EXPECTED.images],
        ["tts_chars", caps.tts_chars, EXPECTED.tts_chars],
        ["llm_tokens", caps.llm_tokens, EXPECTED.llm_tokens],
        ["gpu_seconds", caps.gpu_seconds, EXPECTED.gpu_seconds],
        ["per_account.tts_chars", caps.per_account.tts_chars, EXPECTED.per_account.tts_chars],
        ["per_account.llm_tokens", caps.per_account.llm_tokens, EXPECTED.per_account.llm_tokens],
        ["per_account.gpu_seconds", caps.per_account.gpu_seconds, EXPECTED.per_account.gpu_seconds],
      ];

      let failed = 0;
      for (const [name, actual, expected] of checks) {
        const ok = actual === expected;
        if (!ok) failed += 1;
        console.log(`${ok ? "ok  " : "FAIL"}  ${name.padEnd(24)} ${actual} (expected ${expected})`);
      }

      // The strip-mode half: what is in the row but not in the schema. A
      // mistyped key lands here and nowhere else — the product never sees it.
      const raw = row.value as Record<string, unknown>;
      const rawAccount = (raw.per_account ?? {}) as Record<string, unknown>;
      const stripped = [
        ...Object.keys(raw).filter((k) => !(k in caps)),
        ...Object.keys(rawAccount)
          .filter((k) => !(k in caps.per_account))
          .map((k) => `per_account.${k}`),
      ];
      if (stripped.length > 0) {
        console.log(`WARN  keys in the row that the schema strips: ${stripped.join(", ")}`);
        console.log("      The product never reads these. A mistyped cap looks exactly like this.");
      }

      console.log(failed === 0 ? "\nPASS — all seven values match." : `\nFAIL — ${failed} of 7.`);
      return failed === 0 ? 0 : 1;
    });
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
