import { notFound, redirect } from "next/navigation";
import { authedUser } from "@/lib/auth-user";
import { postingAllowed } from "@/lib/social";
import { socialReturnPath } from "@/lib/social-oauth";
import { createServerSupabase } from "@/lib/supabase/server";
import { InstagramPreScreen } from "./prescreen";

/**
 * /home/settings/connect/instagram?return=&add=1 — the pre-screen behind
 * "חיבור חשבון" and "הוספת חשבון" (decision 0101, PR 2). An account the switch
 * does not allow gets the 404 page, exactly as if the path did not exist.
 */
export default async function InstagramConnectPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const supabase = await createServerSupabase();
  const user = authedUser(await supabase.auth.getUser());
  if (!user) redirect("/start");
  if (!(await postingAllowed(user.id))) notFound();

  const params = await searchParams;
  return <InstagramPreScreen returnTo={socialReturnPath(params.return)} add={params.add === "1"} />;
}
