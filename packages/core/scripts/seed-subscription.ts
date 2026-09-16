/**
 * DEV ONLY. Seed one live subscription for an existing account so the account
 * page has something to show (the founder's manual check of the billing UI).
 *
 *   DRY_RUN=1 apps/cli/node_modules/.bin/tsx packages/core/scripts/seed-subscription.ts \
 *     --email founder@example.com --plan pro --days-into-period 10
 *
 * Refuses to run unless DRY_RUN is set: every local .env points at the ONE
 * Supabase project, which is production, and this script WRITES — a
 * subscriptions row, plus the plan's period credits so the balance matches
 * the plan. The DRY_RUN gate is the founder saying "I know which database
 * this is". Nothing here calls a gateway: gateway_recurring_ref is a marker,
 * and DryRunGateway is the only thing that will ever "charge" it.
 *
 * Refuses if the account already holds a live subscription (the 0041 index
 * would refuse anyway; this says why in words). The connection string is read
 * out of .env inside this script and never printed.
 */
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { eq, sql } from "drizzle-orm";
import { getEnv, resetEnvCache } from "../src/config";
import { closeDb, getDb } from "../src/db";
import { plans, subscriptions, users } from "../src/db/schema";
import { addOneMonth, liveSubscription } from "../src/pipelines/billing";
import { creditBalance, grantPeriod } from "../src/pipelines/credits";

function loadDatabaseUrl(): void {
  if (process.env.DATABASE_URL) return;
  const envPath = new URL("../../../.env", import.meta.url);
  const raw = readFileSync(envPath, "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const match = /^\s*DATABASE_URL\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    process.env.DATABASE_URL = match[1]!.trim().replace(/^["']|["']$/g, "");
    resetEnvCache();
    return;
  }
  throw new Error("no DATABASE_URL line in the repo-root .env");
}

async function main(): Promise<void> {
  if (!getEnv().DRY_RUN) {
    console.error("refusing: set DRY_RUN=1 to seed a subscription (this script writes rows)");
    process.exit(1);
  }
  const { values } = parseArgs({
    options: {
      email: { type: "string" },
      plan: { type: "string" },
      "days-into-period": { type: "string", default: "0" },
    },
  });
  if (!values.email || !values.plan) {
    console.error("usage: --email <account email> --plan <plan code> [--days-into-period N]");
    process.exit(1);
  }
  const daysIn = Number(values["days-into-period"]);
  if (!Number.isInteger(daysIn) || daysIn < 0 || daysIn > 31) {
    console.error("--days-into-period must be an integer 0..31");
    process.exit(1);
  }

  loadDatabaseUrl();
  const db = getDb();

  const user = (
    await db
      .select({ id: users.id, email: users.email })
      .from(users)
      .where(sql`lower(${users.email}) = ${values.email.toLowerCase()}`)
      .limit(1)
  )[0];
  if (!user) throw new Error(`no users row for ${values.email} — sign in once first`);

  const plan = (await db.select().from(plans).where(eq(plans.code, values.plan)).limit(1))[0];
  if (!plan || !plan.active) throw new Error(`no active plan with code ${values.plan}`);

  const existing = await liveSubscription(db, user.id);
  if (existing) {
    throw new Error(
      `account already holds a live subscription (${existing.id}, ${existing.planCode}, ${existing.status})`,
    );
  }

  const now = new Date();
  const periodStart = new Date(now.getTime() - daysIn * 24 * 60 * 60 * 1000);
  const periodEnd = addOneMonth(periodStart);

  const sub = (
    await db
      .insert(subscriptions)
      .values({
        userId: user.id,
        planCode: plan.code,
        status: "active",
        gatewayRecurringRef: "seed_dry_run",
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd,
      })
      .returning()
  )[0]!;
  await grantPeriod(db, {
    userId: user.id,
    credits: plan.monthlyCredits,
    subscriptionId: sub.id,
    note: "seed-subscription.ts (dev)",
  });

  console.log("seeded subscription");
  console.log(`  id            ${sub.id}`);
  console.log(`  account       ${user.email}`);
  console.log(`  plan          ${plan.code} (${plan.name})`);
  console.log(`  gateway       ${sub.gateway}`);
  console.log(`  period        ${periodStart.toISOString()} → ${periodEnd.toISOString()}`);
  console.log(`  balance now   ${await creditBalance(db, user.id)}`);
  console.log("undo: delete the subscriptions row and its grant_period ledger row by id");

  await closeDb();
}

void main().catch(async (err) => {
  console.error(err instanceof Error ? err.message : err);
  await closeDb();
  process.exit(1);
});
