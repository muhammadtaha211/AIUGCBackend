import { notFound } from "next/navigation";
import { getAutopilotSetup, getDb } from "@aiugc/core";
import { authedUser } from "@/lib/auth-user";
import { autopilotAllowed } from "@/lib/autopilot";
import { createServerSupabase } from "@/lib/supabase/server";
import { AutopilotSetup } from "./autopilot-setup";

/**
 * /autopilot — the Instagram autopilot's one setup (decision 0127). In the
 * (posting) group, whose layout gates posting before any Suspense boundary;
 * this page adds the autopilot's own gate, so an account it hides gets the
 * real 404 an unknown path gets.
 */
export default async function AutopilotPage() {
  const supabase = await createServerSupabase();
  const user = authedUser(await supabase.auth.getUser());
  if (!user || !(await autopilotAllowed(user.id))) notFound();
  const setup = await getAutopilotSetup(getDb(), user.id);
  return <AutopilotSetup initial={setup} />;
}
