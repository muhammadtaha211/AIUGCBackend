import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";

/**
 * The tail of the PKCE code-verifier cookie's name. Both halves of it were
 * read, not recalled:
 *
 * - @supabase/ssr forces `flowType: "pkce"` on both factories
 *   (createServerClient.js:33, createBrowserClient.js:40) and overrides the
 *   storage key only from `cookieOptions.name` (:29-31), which is configured
 *   NOWHERE in this repo — so the key stays supabase-js's default,
 *   `sb-${hostname.split(".")[0]}-auth-token` (supabase-js dist/index.cjs:1270).
 * - auth-js writes the verifier under `${storageKey}-code-verifier`
 *   (lib/helpers.js:269-275, `getCodeChallengeAndMethod`), called from the PKCE
 *   branch of `_getUrlForProvider` (GoTrueClient.js:4702-4703).
 *
 * Matched by SUFFIX, not rebuilt from the project ref: rebuilding it would mean
 * parsing NEXT_PUBLIC_SUPABASE_URL here and keeping that derivation in step
 * with supabase-js's forever. The suffix is the part both halves agree on, and
 * this comment is the coupling made visible — if either library changes the
 * name, this constant is what has to move.
 *
 * Not chunk-aware, and does not need to be: the verifier is 56 characters
 * (auth-js lib/helpers.js:235) against a 3180-byte chunk threshold
 * (@supabase/ssr utils/chunker.js:8), so it is never split into `.0`/`.1`.
 */
const CODE_VERIFIER_SUFFIX = "-auth-token-code-verifier";

/**
 * Did an auth round-trip start in THIS browser, on THIS origin?
 *
 * The PKCE code verifier is the only browser-side evidence that one did. It is
 * written when `signInWithOAuth` builds the provider URL and it is scoped to
 * the origin that wrote it, so its presence is the closest thing this route has
 * to "you started this".
 *
 * Why the clear needs it: `/auth/callback?error=x` takes the failure branch on
 * the query string alone, and the auth cookies are `SameSite=Lax`, which the
 * browser DOES send on a top-level cross-site GET. Without this guard any link,
 * posted anywhere, signs out whoever follows it. With it, the drive-by finds no
 * verifier and the branch behaves exactly as it did before the clear existed:
 * redirect, log, touch nothing.
 *
 * Lax is also why the guard does not break the real flow — GoTrue's redirect
 * back here is itself a cross-site top-level GET, and it carries the verifier
 * for the same reason the drive-by carries the session.
 */
function startedHere(cookieStore: Awaited<ReturnType<typeof cookies>>): boolean {
  return cookieStore
    .getAll()
    .some(({ name, value }) => name.endsWith(CODE_VERIFIER_SUFFIX) && value !== "");
}

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
    // BEFORE the exchange, and that placement is load-bearing.
    // `_exchangeCodeForSession` removes the verifier on every outcome it has —
    // at GoTrueClient.js:1591, ahead of the `if (error) throw` on the line
    // below it, and again at :1609 in its own catch — so the read has to happen
    // while the evidence is still there. It is also the honest question: "did
    // this browser start a round-trip", about the request as it ARRIVED, not
    // about what we did to the cookie jar afterwards.
    const started = startedHere(await cookies());
    const supabase = await createServerSupabase();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(`${origin}/start`);
    // The message only — the code is a credential and never gets logged.
    console.error("[auth/callback] code exchange failed:", error.message.slice(0, 200));
    if (started) await endPreviousSession(supabase);
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
    // No client of its own — the failure message was all this branch produced,
    // and the session the browser arrived with outlived it. The helper builds
    // one INSIDE its guard: `await createServerSupabase()` as an argument here
    // would be evaluated outside it, and a factory throw (an unset
    // NEXT_PUBLIC_SUPABASE_* on some deploy) would replace the message with a
    // 500 on the one branch whose whole job is to show it.
    //
    // Nothing removes the verifier on this branch, so the read can sit here.
    // No verifier means no round-trip started here, and then this branch is
    // byte-for-byte what it was before the clear existed — including building
    // no client at all.
    if (startedHere(await cookies())) await endPreviousSession();
    return NextResponse.redirect(`${origin}/login?error=oauth`);
  }

  return NextResponse.redirect(`${origin}/start`);
}

/**
 * Ends whatever session this browser was already carrying, on the two paths
 * that end at /login?error=oauth — and only when `startedHere` says this
 * browser began the round-trip.
 *
 * Without it a failed round-trip leaves the customer reading "ההתחברות עם
 * Google לא הצליחה" while still signed in as the account they were in before
 * — and the `/` -> /home owner bounce walks them straight back into it. The
 * forward added in `fix/site-url-landing` routes a Site-URL landing through
 * exactly these two branches, so the wrong-account case now arrives here.
 * See docs/vault/defects/the-site-url-landing-signs-you-into-the-wrong-account.md
 *
 * `local`, not `global`: the same person's phone keeps its session. The one
 * this browser holds is the only one that failed.
 *
 * Best-effort, deliberately. The message is what the user came for, so a clear
 * that cannot happen is logged and the redirect goes out unchanged. It can
 * resolve an `error` and it can REJECT, and both are handled — the rejection
 * because `_callRefreshToken` throws before its own try when handed a falsy
 * refresh token (auth-js 2.110.6 GoTrueClient.js:4096-4098) and `_useSession`
 * wraps the call in try/finally with no catch. NOT because the cookie write
 * throws: `setAll` in lib/supabase/server.ts swallows its own throws, so the
 * listener boundary (@supabase/ssr createServerClient.js:48-66) never sees one
 * from this client.
 *
 * ONE CASE CLEARS NOTHING, and it is not the obvious one. When signOut's own
 * session read has to refresh, auth-js splits three ways (GoTrueClient.js
 * :2517-2538 and :4191-4214):
 *
 * - access token still valid (a proactive refresh inside the 90s margin) ->
 *   the session is handed back with no error and the clear runs normally;
 * - access token expired, refresh rejected NON-retryably (revoked token) ->
 *   `_callRefreshToken` already called `_removeSession` at `:4212`, so the
 *   cookie removal has gone out before signOut returns its error;
 * - access token expired AND the refresh failed RETRYABLY — GoTrue 5xx or
 *   unreachable -> `:4195` skips that removal, the session stays in storage,
 *   `__loadSession` returns the error at `:2538`, and signOut returns early at
 *   `:3368-3370` WITHOUT clearing. The browser keeps an intact session whose
 *   refresh token works again the moment GoTrue recovers.
 *
 * That last one is a real hole, not a bounded one: during the outage the
 * middleware reads the failure as "could not tell" and routes nobody, but
 * afterwards the `/` -> /home owner bounce this exists to stop fires again.
 * Left open on purpose — closing it means writing the cookie removals by hand
 * instead of asking auth-js to.
 * See the defect note's "Three measured limits of the clear".
 */
async function endPreviousSession(existing?: Awaited<ReturnType<typeof createServerSupabase>>) {
  try {
    const supabase = existing ?? (await createServerSupabase());
    const { error } = await supabase.auth.signOut({ scope: "local" });
    if (error) {
      console.error(
        "[auth/callback] could not end the previous session:",
        error.message.slice(0, 200),
      );
    }
  } catch (thrown) {
    console.error("[auth/callback] could not end the previous session:", thrown);
  }
}
