/**
 * Supabase Auth wrappers for the browser. Session state lives only in the
 * Supabase auth cookies (@supabase/ssr) — no local session storage.
 * Every failure surfaces as a Hebrew message the forms can show inline.
 */

import { isAuthApiError } from "@supabase/supabase-js";
import { createClient } from "./supabase/client";

export type AuthResult = { ok: true } | { ok: false; error: string };

/**
 * The single switch for Google sign-in in the UI. Both entry points read it —
 * the signup wizard's last step and the login form — and each hides its Google
 * button *and* the "או" divider above the email form when it is false.
 *
 * Flip to false if Google's verification review comes back badly. That is the
 * whole point of it being one constant: with the provider off in Supabase the
 * buttons do not fail gracefully. `signInWithOAuth` makes no network call — it
 * runs `window.location.assign(...)` — so the browser leaves the app, Supabase
 * rejects the unconfigured provider, and the user is dropped back on the
 * marketing page with no message and their wizard draft stranded in
 * localStorage. The Hebrew fallback below never gets a chance to render.
 */
export const GOOGLE_SIGN_IN_ENABLED = true;

const GENERIC_ERROR = "משהו השתבש. נסו שוב בעוד רגע.";

/** Map Supabase auth error codes to inline Hebrew messages. */
function hebrewAuthError(error: unknown): string {
  const code = isAuthApiError(error) ? error.code : undefined;
  switch (code) {
    case "invalid_credentials":
      return "לא מצאנו חשבון עם הפרטים האלה.";
    case "user_already_exists":
    case "email_exists":
      return "כבר קיים חשבון עם האימייל הזה — אפשר פשוט להיכנס.";
    case "email_not_confirmed":
      return "האימייל עוד לא אושר — בדקו את תיבת הדואר שלכם.";
    case "over_request_rate_limit":
    case "over_email_send_rate_limit":
      return "יותר מדי ניסיונות — חכו רגע ונסו שוב.";
    case "weak_password":
      return "הסיסמה חלשה מדי — נסו סיסמה ארוכה יותר.";
    case "validation_failed":
      return "כתובת המייל לא נראית תקינה.";
    case "email_provider_disabled":
    case "signup_disabled":
      return "ההרשמה באימייל כבויה כרגע — צריך להפעיל את ספק ה־Email בהגדרות Supabase.";
    default:
      return GENERIC_ERROR;
  }
}

export async function signUp(email: string, password: string): Promise<AuthResult> {
  try {
    const { data, error } = await createClient().auth.signUp({
      email,
      password,
      // Without this the confirmation link returns to the Site URL root, and
      // `/` is a static marketing page that never reads searchParams — so the
      // click silently does nothing. /auth/callback already exchanges the PKCE
      // code. Confirm-email is OFF for launch, so this is latent today and
      // deliberately correct for the day it is turned on.
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    });
    if (error) return { ok: false, error: hebrewAuthError(error) };
    if (!data.session) {
      // Email confirmation is enabled in the dashboard — no session yet.
      return { ok: false, error: "שלחנו מייל אישור. אשרו אותו ואז היכנסו דרך מסך הכניסה." };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: GENERIC_ERROR };
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

/**
 * Google OAuth (PKCE). On success the browser navigates away to Google and
 * comes back through /auth/callback — this only returns when something failed
 * (e.g. the provider isn't configured in the Supabase dashboard yet).
 */
export async function signUpWithGoogle(): Promise<AuthResult> {
  try {
    const { error } = await createClient().auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
    if (error) {
      return {
        ok: false,
        error: "ההתחברות עם Google לא זמינה כרגע — אפשר להמשיך עם אימייל וסיסמה.",
      };
    }
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
