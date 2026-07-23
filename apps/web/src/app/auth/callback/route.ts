import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";

/**
 * OAuth (PKCE) landing point. Exchanges the code for a session cookie, then
 * returns to the wizard — OnboardingFlow sees the session and finishes the
 * draft (or the middleware sends existing owners straight to /home).
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");

  if (code) {
    const supabase = await createServerSupabase();
    await supabase.auth.exchangeCodeForSession(code);
  }

  return NextResponse.redirect(`${origin}/start`);
}
