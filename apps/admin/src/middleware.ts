import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
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

  const supabase = createServerClient(supabaseUrl(), supabaseAnonKey(), {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
      },
    },
  });

  // Session refresh must run on every request (the only place cookie refresh
  // can happen for Server Components) — before the /login early-return.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  if (path === "/login") return response;

  const deny = () =>
    path.startsWith("/api")
      ? NextResponse.json({ ok: false, error: "אין הרשאה." }, { status: 403 })
      : NextResponse.redirect(new URL("/login", request.url));

  if (!user) return deny();

  // RLS-scoped read of the session user's own row (users_select_self).
  const { data: rows } = await supabase.from("users").select("role").eq("id", user.id).limit(1);
  if (rows?.[0]?.role !== "admin") return deny();

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
