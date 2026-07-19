/**
 * Auth stub — the UI is final, the wiring isn't.
 * TODO: replace with Supabase Auth (auth.signUp / signInWithPassword /
 * signInWithOAuth) once the Supabase project exists. Keep the same signatures.
 */

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function signUp(_email: string, _password: string): Promise<{ ok: true }> {
  await delay(900);
  return { ok: true };
}

export async function signUpWithGoogle(): Promise<{ ok: true; email: string }> {
  await delay(700);
  return { ok: true, email: "" };
}

export async function signIn(
  _email: string,
  _password: string,
): Promise<{ ok: false; error: string }> {
  await delay(700);
  // No accounts exist yet — every attempt honestly fails.
  return { ok: false, error: "לא מצאנו חשבון עם הפרטים האלה." };
}

/** Dev session — localStorage stand-in for a real auth session, same TODO as above. */

export type Session = { email: string };

const SESSION_KEY = "aiugc.session.v1";

export function saveSession(email: string): void {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify({ email }));
  } catch {
    // Storage unavailable — the redirect still happens, the session just won't persist.
  }
}

export function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Session>;
    return typeof parsed.email === "string" ? { email: parsed.email } : null;
  } catch {
    return null;
  }
}

export function clearSession(): void {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch {
    // Nothing to clean up if storage is unavailable.
  }
}
