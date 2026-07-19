import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Core is shipped as TypeScript source ("./src/index.ts" exports) — Next compiles it.
  transpilePackages: ["@aiugc/core"],
  // Native/dynamic-require packages stay as runtime node_modules requires.
  serverExternalPackages: [
    "@electric-sql/pglite",
    "postgres",
    "pino",
    "@anthropic-ai/sdk",
    "@supabase/supabase-js",
  ],
};

export default nextConfig;
