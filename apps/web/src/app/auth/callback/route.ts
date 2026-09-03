import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";

/**
 * OAuth (PKCE) landing point. A good exchange returns to the wizard —
 * OnboardingFlow sees the session and either finishes the draft or hands the
 * user on to /home/new-business (the middleware sends existing owners to
 * /home before either runs).
 *
 * A round-trip that failed must say so instead of dropping the user on a
 * wizard that looks like nothing happened. GoTrue attaches provider failures
 * to the redirect as query params (Google refusing at the account chooser
 * arrives as `error=access_denied`), and a route handler can only ever see the
 * query string — a fragment never leaves the browser. So: only a working
 * exchange continues to /start; everything else goes to /login with a message.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");

  if (code) {
    const supabase = await createServerSupabase();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(`${origin}/start`);
    // The message only — the code is a credential and never gets logged.
    console.error("[auth/callback] code exchange failed:", error.message.slice(0, 200));
    return NextResponse.redirect(`${origin}/login?error=oauth`);
  }

  const providerError = searchParams.get("error") ?? searchParams.get("error_code");
  const description = searchParams.get("error_description");
  if (providerError || description) {
    console.error(
      "[auth/callback] provider returned an error:",
      providerError?.slice(0, 200),
      description?.slice(0, 200),
    );
    return NextResponse.redirect(`${origin}/login?error=oauth`);
  }

  return NextResponse.redirect(`${origin}/start`);
}
