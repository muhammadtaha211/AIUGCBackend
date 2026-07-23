import Link from "next/link";
import { redirect } from "next/navigation";
import { OnboardingFlow } from "@/components/onboarding/onboarding-flow";
import { Wordmark } from "@/components/wordmark";
import { createServerSupabase } from "@/lib/supabase/server";
import { LogoutButton } from "../logout-button";

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
    <div className="relative isolate flex min-h-dvh flex-col overflow-hidden">
      <header className="flex h-16 shrink-0 items-center justify-between px-6 sm:px-10">
        <Link href="/home">
          <Wordmark />
        </Link>
        <div className="flex items-center gap-4">
          <Link
            href="/home"
            className="text-sm text-gray-400 transition-colors duration-150 hover:text-white"
          >
            חזרה לדף הבית
          </Link>
          <LogoutButton />
        </div>
      </header>

      <main className="flex flex-1 flex-col items-center px-6 pb-20">
        <OnboardingFlow mode="additional" />
      </main>
    </div>
  );
}
