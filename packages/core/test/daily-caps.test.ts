import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { dailyCapsSchema } from "../src/config";
import * as schema from "../src/db/schema";
import { createTestDb } from "./helpers/pglite";

/**
 * `daily_caps` after 0036, read back THROUGH the schema.
 *
 * Not a raw SELECT, and that is the whole point: `dailyCapsSchema`
 * (config.ts:39-54) is a plain `z.object` at both levels — strip mode — and
 * nothing validates writes to `app_config`. A mistyped key survives in the row
 * and the product never sees it, so the row can look changed while the cap has
 * not moved (docs/vault/facts/token-and-money-budgets.md). Parsing the way the
 * product parses is the only read-back that means anything.
 *
 * The production twin of this file is packages/core/scripts/verify-daily-caps.ts,
 * which runs the same comparison against the live row.
 */

/** Founder decision 2026-09-10, implementing vault 0040. */
const TARGET = {
  images: 400,
  tts_chars: 400_000,
  llm_tokens: 8_000_000,
  gpu_seconds: 32_000,
  per_account: { tts_chars: 25_000, llm_tokens: 500_000, gpu_seconds: 2_000 },
};

async function capsRow() {
  const fixture = await createTestDb();
  const rows = await fixture.db
    .select()
    .from(schema.appConfig)
    .where(eq(schema.appConfig.key, "daily_caps"));
  return { ...fixture, value: rows[0]?.value as Record<string, unknown> | undefined };
}

describe("daily_caps", () => {
  it("all seven values survive the schema and equal the target", async () => {
    const { pg, value } = await capsRow();

    // toEqual, not toMatchObject: a partial match is how the llm cap drifted
    // from its migration unnoticed for five days
    // (docs/vault/defects/migration-0027-still-seeds-the-old-llm-cap.md).
    expect(dailyCapsSchema.parse(value)).toEqual(TARGET);

    await pg.close();
  });

  it("every platform cap is exactly 16x its per_account pair", async () => {
    const { pg, value } = await capsRow();
    const caps = dailyCapsSchema.parse(value);

    // The rule 0036 records in its header, so the numbers stay re-derivable.
    // `images` has no per_account pair and is deliberately not in it.
    expect(caps.tts_chars).toBe(caps.per_account.tts_chars * 16);
    expect(caps.llm_tokens).toBe(caps.per_account.llm_tokens * 16);
    expect(caps.gpu_seconds).toBe(caps.per_account.gpu_seconds * 16);

    await pg.close();
  });

  it("no per_account.images key was written — it would be dead on arrival", async () => {
    const { pg, value } = await capsRow();

    // The RAW row, not the parsed object: the schema strips the key either way,
    // so parsing first would make this assertion vacuous. assertAccountBudget's
    // `kind` is typed keyof …["per_account"] (budget.ts:75), there is no call
    // site anywhere, and zero usage_events rows of kind `images` have ever
    // existed — docs/vault/facts/per-account-cap-blind-spot.md.
    const perAccount = (value?.per_account ?? {}) as Record<string, unknown>;
    expect(Object.keys(perAccount).sort()).toEqual(["gpu_seconds", "llm_tokens", "tts_chars"]);

    await pg.close();
  });

  it("the row carries no key the schema would silently strip", async () => {
    const { pg, value } = await capsRow();
    const caps = dailyCapsSchema.parse(value);

    // Strip mode makes an unknown key invisible to the product forever. The
    // migration must leave none behind.
    expect(Object.keys(value ?? {}).sort()).toEqual(Object.keys(caps).sort());

    await pg.close();
  });
});
