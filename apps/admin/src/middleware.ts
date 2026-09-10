import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { authReadFailed } from "@/lib/admin";
import { supabaseAnonKey, supabaseUrl } from "@/lib/supabase/client";

/**
 * Deny-by-default gate for the whole admin origin: every path except /login
 * and static assets requires an authenticated session whose users row is
 * role='admin' — pages redirect to /login, API paths get a 403. A route added
 * tomorrow with no explicit check is therefore closed, not open. This is one
 * of two independent layers: every route handler still calls requireAdmin
 * itself (middleware bypass CVEs exist), and pages still call adminSession.
 *
 * Optional second wall: when ADMIN_BASIC_USER + ADMIN_BASIC_PASS are set, the
 * entire origin (including /login) also demands HTTP Basic Auth. Unset = off.
 */
export async function middleware(request: NextRequest) {
  const basicUser = process.env.ADMIN_BASIC_USER;
  const basicPass = process.env.ADMIN_BASIC_PASS;
  if (basicUser && basicPass) {
    const expected = `Basic ${btoa(`${basicUser}:${basicPass}`)}`;
    if (request.headers.get("authorization") !== expected) {
      return new NextResponse("Authentication required", {
        status: 401,
        headers: { "www-authenticate": 'Basic realm="admin"' },
      });
    }
  }

  let response = NextResponse.next({ request });

  // The no-store headers @supabase/ssr hands `setAll` alongside the rotated
  // cookies (types.d.ts:21-25). They belong on the same response as the
  // cookies — a cached Set-Cookie serves one user's session token to the next
  // — so they are held in a local for the same reason `response` is: `setAll`
  // replaces the response object, and deny() returns neither.
  let authHeaders: Record<string, string> = {};

  // deny() returns a response that is not `response`, so it has to carry the
  // cookies `setAll` just rotated onto it — dropping them leaves the browser
  // presenting a spent refresh token. Reads `response` and `authHeaders` at
  // call time: `setAll` reassigns both, possibly after the users read.
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
        // and clearAuthCookiesAtScopes all pass `{}`. The write below is outside
        // the guard so that headers captured by an earlier call land on the
        // response this call just replaced.
        if (Object.keys(headers).length > 0) authHeaders = headers;
        Object.entries(authHeaders).forEach(([key, value]) => response.headers.set(key, value));
      },
    },
  });

  // Session refresh must run on every request (the only place cookie refresh
  // can happen for Server Components) — before the /login early-return.
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  // Logged and NOT thrown, for the same reason as apps/web's middleware: there
  // is no error boundary above middleware, so a throw is a 500 on every matched
  // path including /login. A failed read leaves `user` null and deny() sends the
  // founder to /login — wrong, but safe, and now recorded as a failure rather
  // than passing for a sign-out. (The bare rethrow in GoTrueClient for a
  // non-AuthError is uncaught here too; same note as apps/web.)
  // authReadFailed, not `if (authError)`: getUser resolves an AuthSessionMissingError
  // for the ordinary signed-out case, and this runs on /login too.
  if (authReadFailed(authError)) console.error("admin middleware: auth read failed", authError);

  const path = request.nextUrl.pathname;
  if (path === "/login") return response;

  const deny = () =>
    path.startsWith("/api")
      ? withAuthCookies(NextResponse.json({ ok: false, error: "אין הרשאה." }, { status: 403 }))
      : withAuthCookies(NextResponse.redirect(new URL("/login", request.url)));

  if (!user) return deny();

  // RLS-scoped read of the session user's own row (users_select_self).
  const { data: rows } = await supabase.from("users").select("role").eq("id", user.id).limit(1);
  if (rows?.[0]?.role !== "admin") return deny();

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
