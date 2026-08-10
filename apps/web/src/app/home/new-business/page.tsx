import { redirect } from "next/navigation";
import { OnboardingFlow } from "@/components/onboarding/onboarding-flow";
import { createServerSupabase } from "@/lib/supabase/server";

/**
 * "הוסף עסק" — the questionnaire wizard for a signed-in user. Same steps as
 * the public onboarding, but no signup and the completion call creates an
 * additional business (allowCreate).
 */
export default async function NewBusinessPage() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/start");

  return (
    <div className="flex flex-col items-center px-6 pb-16">
      <OnboardingFlow mode="additional" />
    </div>
  );
}
