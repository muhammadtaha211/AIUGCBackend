import type { NextConfig } from "next";

// Persona catalog images serve from the public Supabase bucket; next/image
// needs the host allowlisted. `/storage/v1/object/**` also covers the signed
// fallback URLs personas keep until `aiugc persona sync-catalog` runs.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;

const nextConfig: NextConfig = {
  // Core is shipped as TypeScript source ("./src/index.ts" exports) — Next compiles it.
  // From @aiugc/remotion only the pure "./text-fit" subpath is imported.
  transpilePackages: ["@aiugc/core", "@aiugc/remotion"],
  // Native/dynamic-require packages stay as runtime node_modules requires.
  serverExternalPackages: ["postgres", "pino", "@anthropic-ai/sdk", "@supabase/supabase-js"],
  images: {
    // 60 = persona catalog cards (PERSONA_CARD_QUALITY), 75 = the default
    // everywhere else. Next 16 requires the list; 15.5 warns without it.
    qualities: [60, 75],
    ...(supabaseUrl
      ? {
          remotePatterns: [
            {
              protocol: supabaseUrl.startsWith("http:") ? ("http" as const) : ("https" as const),
              hostname: new URL(supabaseUrl).hostname,
              pathname: "/storage/v1/object/**",
            },
          ],
        }
      : {}),
  },
};

export default nextConfig;
