import { notFound } from "next/navigation";
import { authedUser } from "@/lib/auth-user";
import { postingAllowed } from "@/lib/social";
import { createServerSupabase } from "@/lib/supabase/server";
import HomeLayout from "../home/layout";

/**
 * The schedule flow (/schedule/[renderId]) and the calendar (/calendar,
 * /calendar/[postId]) — social posting PR 3, inside the signed-in frame and
 * outside /home ON PURPOSE.
 *
 * Every segment under /home sits inside the Suspense boundary its loading.tsx
 * opens, and a notFound() thrown inside a boundary streams the 404 UI into a
 * response already sent as 200 — a trace of the page (the PR 2 pre-screen's
 * reason, connect/instagram/page.tsx). This layout is above every boundary of
 * its own segments, so the gate runs before anything streams: an account the
 * switch hides, and a signed-out visitor, get a real 404 — the same root page
 * an unknown path gets, never a redirect to /start that would say the page
 * exists. Past the gate it draws exactly the /home frame: the sidebar, the
 * credits pill, the pane.
 */
export default async function PostingLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createServerSupabase();
  const user = authedUser(await supabase.auth.getUser());
  if (!user || !(await postingAllowed(user.id))) notFound();
  return <HomeLayout>{children}</HomeLayout>;
}
