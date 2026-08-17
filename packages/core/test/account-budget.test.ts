import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  AccountBudgetError,
  assertAccountBudget,
  assertBudget,
  PLATFORM_BUDGET_TRIPPED,
  recordUsage,
} from "../src/budget";
import type { Db } from "../src/db";
import * as schema from "../src/db/schema";
import { createBusiness } from "../src/pipelines/businesses";
import { BudgetError } from "../src/jobs/errors";
import { createTestDb } from "./helpers/pglite";

/**
 * The abuse ceiling. TTS is absorbed cost of sale with no debit behind it, so
 * this is the only thing standing between "edit one letter -> regenerate" in a
 * loop and the founder's whole ElevenLabs budget.
 */

/** The shipped per-account cap (0018). */
const PER_ACCOUNT_TTS_CHARS = 25_000;

async function businessFor(db: Db, email: string, role: "customer" | "admin" = "customer") {
  return createBusiness(db, {
    ownerEmail: email,
    name: `Biz ${crypto.randomUUID()}`,
    ownerRole: role,
  });
}

async function burn(db: Db, businessId: string, chars: number) {
  await recordUsage(db, {
    provider: "elevenlabs",
    kind: "tts_chars",
    quantity: chars,
    businessId,
  });
}

describe("per-account TTS cap", { timeout: 60_000 }, () => {
  it("one account at its cap does not block another account", async () => {
    const { db, pg } = await createTestDb();
    const loud = await businessFor(db, "loud@test.local");
    const quiet = await businessFor(db, "quiet@test.local");

    await burn(db, loud.id, PER_ACCOUNT_TTS_CHARS);

    await expect(assertAccountBudget(db, "tts_chars", loud.id)).rejects.toBeInstanceOf(
      AccountBudgetError,
    );
    await expect(assertAccountBudget(db, "tts_chars", quiet.id)).resolves.toBeUndefined();
    await pg.close();
  });

  it("sums ACROSS an owner's businesses — creating more businesses does not raise the cap", async () => {
    const { db, pg } = await createTestDb();
    const first = await businessFor(db, "farmer@test.local");
    // The signed-in "הוסף עסק" wizard creates additional businesses for the
    // same owner, with no limit. A per-business cap would be farmable at 2x.
    const second = await createBusiness(db, {
      ownerEmail: "farmer@test.local",
      name: "Biz two",
    });
    expect(second.ownerUserId).toBe(first.ownerUserId);

    await burn(db, first.id, PER_ACCOUNT_TTS_CHARS / 2);
    await expect(assertAccountBudget(db, "tts_chars", second.id)).resolves.toBeUndefined();

    await burn(db, second.id, PER_ACCOUNT_TTS_CHARS / 2);
    // The second business's own spend is small, but the ACCOUNT is at its cap.
    await expect(assertAccountBudget(db, "tts_chars", second.id)).rejects.toBeInstanceOf(
      AccountBudgetError,
    );
    await pg.close();
  });

  it("ignores usage older than the rolling 24h window", async () => {
    const { db, pg } = await createTestDb();
    const business = await businessFor(db, "yesterday@test.local");
    await burn(db, business.id, PER_ACCOUNT_TTS_CHARS);

    await db
      .update(schema.usageEvents)
      .set({ createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000) })
      .where(eq(schema.usageEvents.businessId, business.id));

    await expect(assertAccountBudget(db, "tts_chars", business.id)).resolves.toBeUndefined();
    await pg.close();
  });

  it("a breach is NOT a BudgetError — that one parks the job and spins the wizard forever", async () => {
    const { db, pg } = await createTestDb();
    const business = await businessFor(db, "spinner@test.local");
    await burn(db, business.id, PER_ACCOUNT_TTS_CHARS);

    const err = await assertAccountBudget(db, "tts_chars", business.id).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AccountBudgetError);
    expect(err).not.toBeInstanceOf(BudgetError);
    await pg.close();
  });

  it("admin-owned accounts bypass it — outreach samples run in volume", async () => {
    const { db, pg } = await createTestDb();
    const founder = await businessFor(db, "founder@test.local", "admin");
    await burn(db, founder.id, PER_ACCOUNT_TTS_CHARS * 10);

    await expect(assertAccountBudget(db, "tts_chars", founder.id)).resolves.toBeUndefined();
    await pg.close();
  });

  it("the platform-wide backstop still fires on its own, independently — and loudly", async () => {
    const { db, pg } = await createTestDb();
    const business = await businessFor(db, "platform@test.local");

    // Under the per-account cap, over the platform cap (100k, seeded).
    for (let i = 0; i < 5; i++) {
      const other = await businessFor(db, `other-${i}@test.local`);
      await burn(db, other.id, 24_000);
    }

    await expect(assertAccountBudget(db, "tts_chars", business.id)).resolves.toBeUndefined();
    await expect(assertBudget(db, "tts_chars")).rejects.toBeInstanceOf(BudgetError);

    // A platform trip now means something is broken, not that we are busy —
    // it must leave a visible trail, not just a parked job.
    const trail = await db
      .select()
      .from(schema.events)
      .where(eq(schema.events.kind, PLATFORM_BUDGET_TRIPPED));
    expect(trail).toHaveLength(1);
    expect(trail[0]!.payload).toMatchObject({ kind: "tts_chars", cap: 100_000 });
    await pg.close();
  });
});

describe("per-account LLM cap (0027 — account-first)", { timeout: 60_000 }, () => {
  /** The shipped per-account cap (0027): 25% of the platform cap, like TTS. */
  const PER_ACCOUNT_LLM_TOKENS = 500_000;

  async function burnLlm(db: Db, businessId: string, tokens: number) {
    await recordUsage(db, {
      provider: "anthropic",
      kind: "llm_tokens",
      quantity: tokens,
      businessId,
    });
  }

  it("caps one account's LLM spend without touching its neighbor; admin bypasses", async () => {
    const { db, pg } = await createTestDb();
    const loud = await businessFor(db, "llm-loud@test.local");
    const quiet = await businessFor(db, "llm-quiet@test.local");
    const founder = await businessFor(db, "llm-founder@test.local", "admin");

    await burnLlm(db, loud.id, PER_ACCOUNT_LLM_TOKENS);
    await burnLlm(db, founder.id, PER_ACCOUNT_LLM_TOKENS * 10);

    await expect(assertAccountBudget(db, "llm_tokens", loud.id)).rejects.toBeInstanceOf(
      AccountBudgetError,
    );
    await expect(assertAccountBudget(db, "llm_tokens", quiet.id)).resolves.toBeUndefined();
    await expect(assertAccountBudget(db, "llm_tokens", founder.id)).resolves.toBeUndefined();
    await pg.close();
  });
});

describe("per-account GPU cap (0022 — account-first)", { timeout: 60_000 }, () => {
  /** The shipped per-account cap (0022): mirrors the TTS ceiling in seconds. */
  const PER_ACCOUNT_GPU_SECONDS = 2_000;

  async function burnGpu(db: Db, businessId: string, seconds: number) {
    await recordUsage(db, {
      provider: "heygen",
      kind: "gpu_seconds",
      quantity: seconds,
      businessId,
    });
  }

  it("caps one account's GPU without touching its neighbor; admin bypasses", async () => {
    const { db, pg } = await createTestDb();
    const loud = await businessFor(db, "gpu-loud@test.local");
    const quiet = await businessFor(db, "gpu-quiet@test.local");
    const founder = await businessFor(db, "gpu-founder@test.local", "admin");

    await burnGpu(db, loud.id, PER_ACCOUNT_GPU_SECONDS);
    await burnGpu(db, founder.id, PER_ACCOUNT_GPU_SECONDS * 10);

    await expect(assertAccountBudget(db, "gpu_seconds", loud.id)).rejects.toBeInstanceOf(
      AccountBudgetError,
    );
    await expect(assertAccountBudget(db, "gpu_seconds", quiet.id)).resolves.toBeUndefined();
    await expect(assertAccountBudget(db, "gpu_seconds", founder.id)).resolves.toBeUndefined();
    await pg.close();
  });
});
