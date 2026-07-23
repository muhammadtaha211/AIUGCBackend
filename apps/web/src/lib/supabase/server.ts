import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { supabaseAnonKey, supabaseUrl } from "./client";

/**
 * Server Supabase client for Server Components, Route Handlers, and Server
 * Actions. Reads the auth session from cookies; RLS applies to every query.
 */
export async function createServerSupabase() {
  const cookieStore = await cookies();

  return createServerClient(supabaseUrl(), supabaseAnonKey(), {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Called from a Server Component — cookie writes are not allowed
          // there; the middleware refreshes sessions instead.
        }
      },
    },
  });
}
