import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { authReadFailed } from "@/lib/auth-user";
import { supabaseAnonKey, supabaseUrl } from "@/lib/supabase/client";

/**
 * GoTrue's PKCE auth codes are UUIDs. REASONED — nothing in this tree pins it,
 * and a `code` that is not UUID-shaped simply keeps today's behaviour. Matched
 * with a local regex rather than `isUuid` (lib/service-b.ts:63) because that
 * module pulls zod and @aiugc/core into what is an Edge bundle on every matched
 * request; api/hooks/route.ts:7 keeps its own copy for the same reason.
 */
const AUTH_CODE_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Does this query string carry the result of an auth round-trip? `error`,
 * `error_code` and `error_description` are what GoTrue writes when one failed;
 * `code` is the PKCE auth code of one it already completed.
 *
 * The UUID test on `code` is why this is a predicate and not a `has("code")`:
 * `/` is the public landing page, and a future `?code=PROMO10` on it must never
 * be eaten by auth routing.
 */
function carriesAuthResult(params: URLSearchParams): boolean {
  if (params.has("error") || params.has("error_code") || params.has("error_description")) {
    return true;
  }
  const code = params.get("code");
  return code !== null && AUTH_CODE_RE.test(code);
}

/**
 * Refreshes the Supabase auth session on every request (the only place cookie
 * refresh can happen for Server Components), forwards an auth round-trip that
 * landed on `/` to the callback that can read it, and enforces the two route
 * rules: unauthenticated /home -> /start, authenticated owner on the wizard ->
 * /home.
 */
export async function middleware(request: NextRequest) {
  // A Google round-trip GoTrue could not deliver to /auth/callback arrives HERE
  // instead, on the Site URL root, carrying its result on the query string. Two
  // sub-cases, told apart by the signature: `?code=` means GoTrue COMPLETED the
  // sign-in server-side and only the return leg missed; `?error=` means it did
  // not complete. Nothing on `/` reads either — app/page.tsx takes no
  // searchParams — and the owner bounce below would forward a visitor who still
  // holds an OLDER session into that account with the query dropped: a
  // wrong-account landing that also destroys the evidence. Hand it instead to
  // the route that already has all four outcomes.
  //
  // `/` only, because the Site URL root is the one place the fallback delivers.
  //
  // Nothing to carry forward: this runs before the Supabase client exists, so
  // no refresh has happened yet, and the /auth/callback request it redirects to
  // runs this same middleware.
  // See docs/vault/defects/the-site-url-landing-signs-you-into-the-wrong-account.md
  if (request.nextUrl.pathname === "/" && carriesAuthResult(request.nextUrl.searchParams)) {
    return NextResponse.redirect(new URL(`/auth/callback${request.nextUrl.search}`, request.url));
  }

  let response = NextResponse.next({ request });

  // The no-store headers @supabase/ssr hands `setAll` alongside the rotated
  // cookies (types.d.ts:21-25). They belong on the same response as the
  // cookies — a cached Set-Cookie serves one user's session token to the next
  // — so they are held in a local for the same reason `response` is: `setAll`
  // replaces the response object, and both early exits return neither.
  let authHeaders: Record<string, string> = {};

  // Both early exits below return a response that is not `response`, so they
  // have to carry the cookies `setAll` just rotated onto it — dropping them
  // leaves the browser presenting a spent refresh token. Reads `response` and
  // `authHeaders` at call time: `setAll` reassigns both, possibly after the
  // businesses read.
  const withAuthCookies = (target: NextResponse) => {
    for (const cookie of response.cookies.getAll()) target.cookies.set(cookie);
    for (const [key, value] of Object.entries(authHeaders)) target.headers.set(key, value);
    return target;
  };

  const supabase = createServerClient(supabaseUrl(), supabaseAnonKey(), {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
        // Only a call that carries headers updates the map: setItem, removeItem
        // and clearAuthCookiesAtScopes all pass `{}`, and stamping no-store from
        // one of those would cost the signed-out marketing pages their edge
        // cache. The write below is outside the guard so that headers captured
        // by an earlier call land on the response this call just replaced.
        if (Object.keys(headers).length > 0) authHeaders = headers;
        Object.entries(authHeaders).forEach(([key, value]) => response.headers.set(key, value));
      },
    },
  });

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  // Logged and NOT thrown, unlike the same call in the /home pages. Middleware
  // sits above every route with no error boundary anywhere near it, so a throw
  // here is a 500 on every matched path — the whole site, including /login,
  // which is the one page someone locked out needs. Today's behaviour is kept
  // on purpose: a failed read leaves `user` null, /home bounces to /start, and
  // the log is the only thing that separates that from a real sign-out.
  //
  // authReadFailed, not `if (authError)`: getUser resolves an AuthSessionMissingError
  // for the ordinary signed-out case, and this middleware runs on every public
  // page — a bare error check would log once per anonymous pageview.
  //
  // Reading the error is not sufficient here and cannot be made so in this file.
  // GoTrueClient's catch ends in a bare `throw error` for anything that is not
  // an AuthError — a cookie adapter throwing inside _useSession — and that path
  // REJECTS instead of populating `error`. In a page it reaches the boundary;
  // here it is the 500 this comment exists to avoid. Closing it means deciding
  // what a can't-tell-who-you-are request should be served, which is a separate
  // call from this one.
  if (authReadFailed(authError)) console.error("middleware: auth read failed", authError);

  const path = request.nextUrl.pathname;

  if (!user && path.startsWith("/home")) {
    return withAuthCookies(NextResponse.redirect(new URL("/start", request.url)));
  }

  if (user && (path === "/" || path === "/start")) {
    // RLS-scoped read: returns rows only for businesses this user owns.
    const { data, error } = await supabase.from("businesses").select("id").limit(1);
    // A failed read is not "owns nothing": it resolves data: null, which fails
    // the same length check an empty [] fails — so the two are indistinguishable
    // at the guard below. Fall through to `response` rather than route on a
    // pooler blip. Naming the case stops a later `data ?? []` rewrite turning
    // the guess back on, and the log is the only record that the read failed
    // here at all (home/layout.tsx logs its own the same way).
    if (error) {
      console.error("middleware: businesses read failed", error);
      return response;
    }
    // Keep `data &&`. The guard above narrows the type to non-null, but
    // postgrest-js still resolves { data: null, error: null } for a
    // 404-with-empty-body (PostgrestBuilder.ts:553-555), and .length on that
    // would 500 both entry routes.
    if (data && data.length > 0) {
      return withAuthCookies(NextResponse.redirect(new URL("/home", request.url)));
    }
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|mp4)$).*)",
  ],
};
