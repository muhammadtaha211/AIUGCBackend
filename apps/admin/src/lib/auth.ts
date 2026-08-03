/**
 * Supabase Auth wrappers for the browser. Session state lives only in the
 * Supabase auth cookies (@supabase/ssr) — no local session storage. The admin
 * app has no signup and no OAuth: email+password sign-in only.
 */

import { isAuthApiError } from "@supabase/supabase-js";
import { createClient } from "./supabase/client";

export type AuthResult = { ok: true } | { ok: false; error: string };

const GENERIC_ERROR = "משהו השתבש. נסו שוב בעוד רגע.";

/** Map Supabase auth error codes to inline Hebrew messages. */
function hebrewAuthError(error: unknown): string {
  const code = isAuthApiError(error) ? error.code : undefined;
  switch (code) {
    case "invalid_credentials":
      return "לא מצאנו חשבון עם הפרטים האלה.";
    case "email_not_confirmed":
      return "האימייל עוד לא אושר — בדקו את תיבת הדואר שלכם.";
    case "over_request_rate_limit":
    case "over_email_send_rate_limit":
      return "יותר מדי ניסיונות — חכו רגע ונסו שוב.";
    case "validation_failed":
      return "כתובת המייל לא נראית תקינה.";
    default:
      return GENERIC_ERROR;
  }
}

export async function signIn(email: string, password: string): Promise<AuthResult> {
  try {
    const { error } = await createClient().auth.signInWithPassword({ email, password });
    if (error) return { ok: false, error: hebrewAuthError(error) };
    return { ok: true };
  } catch {
    return { ok: false, error: GENERIC_ERROR };
  }
}

export async function signOut(): Promise<void> {
  try {
    await createClient().auth.signOut();
  } catch {
    // Cookies are cleared locally even if the network call fails.
  }
}
