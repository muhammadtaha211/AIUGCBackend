import { redirect } from "next/navigation";
import { OnboardingFlow } from "@/components/onboarding/onboarding-flow";
import { authedUser } from "@/lib/auth-user";
import { DRAFT_WAITING_PARAM } from "@/lib/onboarding";
import { createServerSupabase } from "@/lib/supabase/server";

/**
 * "הוסף עסק" — the questionnaire wizard for a signed-in user. Same steps as
 * the public onboarding, but no signup and the completion call creates an
 * additional business (allowCreate).
 *
 * `?draft=1` means /login parked a finished questionnaire the server declined
 * to store (it already had a business for this owner), so the wizard opens
 * with those answers instead of empty. Read here and handed down as a prop,
 * the way login/page.tsx reads `?error=oauth` — the wizard then knows nothing
 * about URLs, and no client component has to reach for useSearchParams, which
 * carries a Suspense rule of its own (components/nav-progress.tsx:73).
 */
export default async function NewBusinessPage({
  searchParams,
}: {
  searchParams: Promise<{ draft?: string }>;
}) {
  const supabase = await createServerSupabase();
  // authedUser throws on a FAILED read rather than letting it collapse into
  // "signed out" — see the note in @/lib/auth-user. A null user still means
  // exactly what it always did.
  const user = authedUser(await supabase.auth.getUser());
  if (!user) redirect("/start");

  const params = await searchParams;

  return (
    <div className="flex flex-col items-center px-6 pb-16">
      <OnboardingFlow mode="additional" seedFromDraft={params[DRAFT_WAITING_PARAM] === "1"} />
    </div>
  );
}
