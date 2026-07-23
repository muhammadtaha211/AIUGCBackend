import { createBrowserClient } from "@supabase/ssr";

/** Browser Supabase client — session lives in auth cookies, shared with the server. */
export function createClient() {
  return createBrowserClient(supabaseUrl(), supabaseAnonKey());
}

export function supabaseUrl(): string {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) throw new Error("NEXT_PUBLIC_SUPABASE_URL is not set — see .env.example");
  return url;
}

export function supabaseAnonKey(): string {
  // Legacy anon key or the newer publishable key — same role, either works.
  const key =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!key) throw new Error("NEXT_PUBLIC_SUPABASE_ANON_KEY is not set — see .env.example");
  return key;
}
