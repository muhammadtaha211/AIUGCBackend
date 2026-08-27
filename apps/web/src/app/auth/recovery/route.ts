import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";

/**
 * Password-recovery landing point (PKCE). Same exchange as /auth/callback,
 * but recovery must not dead-end on /start: a good link continues to the
 * set-new-password form, and a failed exchange (expired, reused, or opened in
 * a different browser than the one that asked) returns to the request form
 * with a message. GoTrue also lands here with error params and no code when
 * the token died before the redirect — same handling.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");

  if (code) {
    const supabase = await createServerSupabase();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(`${origin}/reset-password`);
  }

  return NextResponse.redirect(`${origin}/forgot-password?error=expired`);
}
