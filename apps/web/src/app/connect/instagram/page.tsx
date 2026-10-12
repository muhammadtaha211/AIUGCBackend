import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getDb, getInstagramConnectMode } from "@aiugc/core";
import { authedUser } from "@/lib/auth-user";
import { postingAllowed } from "@/lib/social";
import { socialReturnPath } from "@/lib/social-oauth";
import { PRESCREEN_TITLE } from "@/lib/social-ui";
import { createServerSupabase } from "@/lib/supabase/server";
import { InstagramPreScreen } from "./prescreen";

export const metadata: Metadata = {
  title: `${PRESCREEN_TITLE} | תבנית`,
  robots: { index: false, follow: false },
};

/**
 * /connect/instagram?return=&add=1 — the pre-screen behind "חיבור חשבון" and
 * "הוספת חשבון" (decision 0101, PR 2). What it says follows the Facebook
 * window app_config.instagram_connect opens (0105).
 *
 * Outside /home ON PURPOSE. Every segment under /home sits inside the Suspense
 * boundary its loading.tsx opens, and a notFound() thrown inside a boundary
 * streams the 404 UI into a response already sent as 200 — a trace of the
 * page. Here nothing streams before the check, so an account the switch hides
 * gets a real 404, the same root not-found page an unknown path gets. A
 * signed-out visitor gets it too: a redirect to /start would say the page
 * exists (the middleware's /start bounce covers /home only).
 */
export default async function InstagramConnectPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const supabase = await createServerSupabase();
  const user = authedUser(await supabase.auth.getUser());
  if (!user || !(await postingAllowed(user.id))) notFound();

  const params = await searchParams;
  return (
    <div className="theme-light min-h-dvh bg-paper text-ink">
      <InstagramPreScreen
        returnTo={socialReturnPath(params.return)}
        add={params.add === "1"}
        mode={await getInstagramConnectMode(getDb())}
      />
    </div>
  );
}
