import path from "node:path";
import type { NextConfig } from "next";

// Persona catalog images serve from the public Supabase bucket; next/image
// needs the host allowlisted. `/storage/v1/object/**` also covers the signed
// fallback URLs personas keep until `aiugc persona sync-catalog` runs.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;

const nextConfig: NextConfig = {
  // Core is shipped as TypeScript source ("./src/index.ts" exports) — Next compiles it.
  // From @aiugc/remotion only the pure "./text-fit" and "./timing" subpaths are
  // imported (timing pulls remotion/no-react, which is browser-safe utilities).
  transpilePackages: ["@aiugc/core", "@aiugc/remotion"],
  // Native/dynamic-require packages stay as runtime node_modules requires.
  serverExternalPackages: ["postgres", "pino", "@anthropic-ai/sdk", "@supabase/supabase-js"],
  // renderPrompt reads prompts/<name>/v<N>.md at request time on a computed
  // path, which the file tracer cannot see — deployed lambdas ENOENT'd without
  // these (2026-09-01). Root pinned to the monorepo so the bundle keeps the
  // repo layout; pnpm-workspace.yaml rides along because core's
  // resolveRepoRoot walks up to it as the repo-root marker under bundlers.
  outputFileTracingRoot: path.join(__dirname, "../.."),
  outputFileTracingIncludes: {
    "/api/**": ["../../prompts/**/*", "../../pnpm-workspace.yaml"],
  },
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
