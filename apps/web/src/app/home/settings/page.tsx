import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import {
  getAccountBilling,
  getDb,
  getInstagramConnectMode,
  getTrialView,
  listSocialAccounts,
  questionnaireSchema,
  schema,
} from "@aiugc/core";
import { Button } from "@/components/ui/button";
import { authedUser } from "@/lib/auth-user";
import { questionnaireToDraft } from "@/lib/onboarding";
import {
  periodLine,
  SETTINGS_CHANGE_PLAN,
  SETTINGS_CHOOSE_PLAN,
  SETTINGS_MANUAL_CREDITS_LINE,
  SETTINGS_NO_PLAN,
  SETTINGS_PLAN_TITLE,
  settingsManualCountLine,
  settingsPlanSummary,
  STATUS_LABELS,
  trialLine,
} from "@/lib/plans-ui";
import { BUSINESS_COOKIE, pickSelectedBusiness } from "@/lib/service-b-ui";
import { postingAllowed } from "@/lib/social";
import { socialReturnPath } from "@/lib/social-oauth";
import {
  accountName,
  connectedLine,
  connectOutcomeLine,
  parseSocialOutcome,
} from "@/lib/social-ui";
import { createServerSupabase } from "@/lib/supabase/server";
import { BusinessCard } from "./business-card";
import { SignOutButton } from "./sign-out-button";
import { SocialAccountsSection, type SocialFlash } from "./social-accounts";

/** The status pill's colours — styling only; the words come from STATUS_LABELS. */
const STATUS_PILL: Record<string, string> = {
  active: "bg-accent/25 text-ink",
  past_due: "bg-amber-100 text-amber-900",
  suspended: "bg-red-100 text-red-700",
};

/**
 * The one page behind both account-menu rows (פרופיל and הגדרות — vault
 * decision 0034): the account block, the plan row, חיבורים (the social
 * accounts — only for an account the posting switch allows, decision 0101),
 * then every business the user owns with an inline questionnaire editor. Same shell as /home/demos; no redirect on
 * an empty list — the section's empty state links to the wizard instead.
 *
 * Drizzle over getDb(), not supabase-js: getDb() bypasses RLS, so the owner
 * filter below IS the access rule — the same predicate RLS applies to the
 * sidebar's list (docs/vault/facts/data-api-surface-is-two-tables.md).
 */
export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const supabase = await createServerSupabase();
  // authedUser throws on a FAILED read rather than letting it collapse into
  // "signed out" — see the note in @/lib/auth-user. A null user still means
  // exactly what it always did.
  const user = authedUser(await supabase.auth.getUser());
  if (!user) redirect("/start");

  const rows = await getDb()
    .select({
      id: schema.businesses.id,
      name: schema.businesses.name,
      questionnaire: schema.businesses.questionnaire,
    })
    .from(schema.businesses)
    .where(eq(schema.businesses.ownerUserId, user.id))
    .orderBy(asc(schema.businesses.createdAt));

  // The same read /home/plan works from, so this row and that page cannot
  // disagree about the plan, its dates or what is pending on it.
  const [billing, trialView] = await Promise.all([
    getAccountBilling(getDb(), { userId: user.id }),
    getTrialView(getDb(), user.id),
  ]);
  const sub = billing.subscription;
  // A ₪5 intro trial that has not joined a plan (decision 0109): its own line,
  // and the manual line then names its count — not every credit is manual.
  const trial =
    trialView && !trialView.convertedAt
      ? {
          credits: trialView.credits,
          creditsLeft: trialView.creditsLeft,
          ended: trialView.ended,
          expiresAt: trialView.expiresAt.toISOString(),
          expiredAt: trialView.expiredAt?.toISOString() ?? null,
          convertedAt: null,
          attemptPending: trialView.attemptPending,
        }
      : null;
  const trialLive = trial !== null && !trial.ended;
  // What survives day 30: everything that is not unused trial credit — the
  // same remainder the expiry leaves, never the lifetime sum of hand grants.
  const lasting = Math.max(0, billing.balance - (trial?.creditsLeft ?? 0));
  // billing.currentPlan is the subscribed row looked up WITHOUT the active
  // filter — a retired plan keeps serving (getAccountBilling's own note) and
  // still has a Hebrew name and a price. The code is the last resort only.
  const plan = billing.currentPlan;
  const planName = plan?.name ?? sub?.planCode ?? "";
  const scheduledName = sub?.scheduledPlanCode
    ? (billing.plans.find((p) => p.code === sub.scheduledPlanCode)?.name ?? sub.scheduledPlanCode)
    : null;
  // The same helper the plan page's status line uses — one sentence, two
  // surfaces, and past_due/suspended say the charge failed instead of
  // promising a "next charge" on a date that has already passed.
  const whatNext = sub
    ? periodLine(
        {
          planCode: sub.planCode,
          status: sub.status,
          currentPeriodStart: sub.currentPeriodStart.toISOString(),
          currentPeriodEnd: sub.currentPeriodEnd.toISOString(),
          cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
          scheduledPlanCode: sub.scheduledPlanCode,
        },
        scheduledName,
      )
    : null;

  // חיבורים: nothing of it is read, let alone rendered, for an account the
  // switch hides. `?social=` is the Facebook round trip's outcome, `?return=`
  // the address a connect should land on (the schedule flow's, in PR 3).
  const social = (await postingAllowed(user.id))
    ? await (async () => {
        const params = await searchParams;
        const accounts = await listSocialAccounts(getDb(), user.id);
        const outcome = parseSocialOutcome(params.social);
        let flash: SocialFlash | null = null;
        if (outcome && outcome !== "connected") {
          // The "no account" line's advice follows the window the mode opens (0105).
          const mode = outcome === "none" ? await getInstagramConnectMode(getDb()) : "standard";
          flash = { kind: "error", text: connectOutcomeLine(outcome, mode) };
        }
        if (outcome === "connected") {
          const count = Number(params.n);
          const named = accounts.find((account) => account.id === params.id);
          if (Number.isInteger(count) && count > 0) {
            flash = { kind: "ok", text: connectedLine(count, named ? accountName(named) : null) };
          }
        }
        return { accounts, flash, returnTo: socialReturnPath(params.return) };
      })()
    : null;

  const cookieStore = await cookies();
  const selectedId = pickSelectedBusiness(rows, cookieStore.get(BUSINESS_COOKIE)?.value)?.id;

  const businesses = rows.map((row) => {
    // No questionnaire yet (a CLI-created business, an interrupted signup) —
    // the card says so and its editor opens empty.
    const parsed = questionnaireSchema.safeParse(row.questionnaire);
    return {
      id: row.id,
      name: row.name,
      questionnaire: parsed.success ? questionnaireToDraft(parsed.data) : null,
    };
  });

  return (
    <div className="mx-auto w-full max-w-3xl px-6 pb-16 pt-8 sm:pt-10">
      <h1 className="text-2xl font-semibold tracking-tight text-ink">הגדרות</h1>
      <p className="mt-2 text-[15px] text-ink/65">
        החשבון שלכם והשאלון של כל עסק. מה שכתוב בשאלון הוא מה שהמודעות נכתבות ממנו.
      </p>

      <section className="mt-8">
        <h2 className="text-lg font-semibold text-ink">החשבון</h2>
        <div className="mt-3 flex flex-col gap-4 rounded-xl border border-ink/[0.08] bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-xs font-medium text-ink/60">אימייל</p>
            <p dir="ltr" className="mt-0.5 truncate text-end text-sm font-medium text-ink">
              {user.email}
            </p>
          </div>
          <SignOutButton />
        </div>
      </section>

      {/* The plan row: what the account is on and what happens at the next
          charge, in one line each. Changing anything is /home/plan's job. */}
      <section className="mt-10">
        <h2 className="text-lg font-semibold text-ink">{SETTINGS_PLAN_TITLE}</h2>
        <div className="mt-3 flex flex-col gap-4 rounded-xl border border-ink/[0.08] bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
          {sub ? (
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-medium text-ink">{planName}</p>
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                    STATUS_PILL[sub.status] ?? "bg-ink/[0.06] text-ink/70"
                  }`}
                >
                  {STATUS_LABELS[sub.status] ?? sub.status}
                </span>
              </div>
              {plan && <p className="mt-0.5 text-sm text-ink/70">{settingsPlanSummary(plan)}</p>}
              <p className="mt-1 text-sm text-ink/65">{whatNext}</p>
            </div>
          ) : (
            <div className="min-w-0">
              <p className="text-sm font-medium text-ink">{SETTINGS_NO_PLAN}</p>
              {trial && <p className="mt-1 text-sm text-ink/65">{trialLine(trial)}</p>}
              {trialLive
                ? lasting > 0 &&
                  billing.manualOutstanding > 0 && (
                    <p className="mt-1 text-sm text-ink/65">{settingsManualCountLine(lasting)}</p>
                  )
                : billing.manualOutstanding > 0 && (
                    <p className="mt-1 text-sm text-ink/65">{SETTINGS_MANUAL_CREDITS_LINE}</p>
                  )}
            </div>
          )}
          <Link href="/home/plan" className="shrink-0">
            {sub ? (
              <Button type="button" variant="secondary">
                {SETTINGS_CHANGE_PLAN}
              </Button>
            ) : (
              <Button type="button">{SETTINGS_CHOOSE_PLAN}</Button>
            )}
          </Link>
        </div>
      </section>

      {social && (
        <SocialAccountsSection
          accounts={social.accounts}
          flash={social.flash}
          returnTo={social.returnTo}
        />
      )}

      <section className="mt-10">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-lg font-semibold text-ink">העסקים שלי</h2>
          <Link
            href="/home/new-business"
            className="text-sm text-ink/70 underline decoration-ink/25 underline-offset-4 transition-colors duration-150 hover:text-ink"
          >
            הוספת עסק
          </Link>
        </div>

        {businesses.length === 0 ? (
          <p className="mt-3 rounded-xl border border-dashed border-ink/15 bg-ink/[0.04] px-6 py-8 text-center text-sm text-ink/60">
            עוד אין עסקים. העסק הראשון נוצר דרך ״הוספת עסק״.
          </p>
        ) : (
          <ul className="mt-3 flex flex-col gap-4">
            {businesses.map((business) => (
              <BusinessCard
                key={business.id}
                business={business}
                selected={business.id === selectedId}
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
