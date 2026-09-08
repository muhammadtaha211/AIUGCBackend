import { cookies } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { getDb, questionnaireSchema, schema } from "@aiugc/core";
import { questionnaireToDraft } from "@/lib/onboarding";
import { BUSINESS_COOKIE, pickSelectedBusiness } from "@/lib/service-b-ui";
import { createServerSupabase } from "@/lib/supabase/server";
import { BusinessCard } from "./business-card";
import { SignOutButton } from "./sign-out-button";

/**
 * The one page behind both account-menu rows (פרופיל and הגדרות — vault
 * decision 0034): the account block, then every business the user owns with
 * an inline questionnaire editor. Same shell as /home/demos; no redirect on
 * an empty list — the section's empty state links to the wizard instead.
 *
 * Drizzle over getDb(), not supabase-js: getDb() bypasses RLS, so the owner
 * filter below IS the access rule — the same predicate RLS applies to the
 * sidebar's list (docs/vault/facts/data-api-surface-is-two-tables.md).
 */
export default async function SettingsPage() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
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
