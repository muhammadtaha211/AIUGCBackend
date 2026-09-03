import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { supabaseAnonKey, supabaseUrl } from "@/lib/supabase/client";

/**
 * Refreshes the Supabase auth session on every request (the only place cookie
 * refresh can happen for Server Components) and enforces the two route rules:
 * unauthenticated /home -> /start, authenticated owner on the wizard -> /home.
 */
export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  // Both early exits below return a response that is not `response`, so they
  // have to carry the cookies `setAll` just rotated onto it — dropping them
  // leaves the browser presenting a spent refresh token. Reads `response` at
  // call time: `setAll` reassigns it, possibly after the businesses read.
  const withAuthCookies = (target: NextResponse) => {
    for (const cookie of response.cookies.getAll()) target.cookies.set(cookie);
    return target;
  };

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

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;

  if (!user && path.startsWith("/home")) {
    return withAuthCookies(NextResponse.redirect(new URL("/start", request.url)));
  }

  if (user && (path === "/" || path === "/start")) {
    // RLS-scoped read: returns rows only for businesses this user owns.
    const { data } = await supabase.from("businesses").select("id").limit(1);
    if (data && data.length > 0) {
      return withAuthCookies(NextResponse.redirect(new URL("/home", request.url)));
    }
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
