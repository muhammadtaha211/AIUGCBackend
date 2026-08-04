import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Core is shipped as TypeScript source ("./src/index.ts" exports) — Next compiles it.
  // From @aiugc/remotion only the pure "./text-fit" subpath is imported.
  transpilePackages: ["@aiugc/core", "@aiugc/remotion"],
  // Native/dynamic-require packages stay as runtime node_modules requires.
  serverExternalPackages: ["postgres", "pino", "@anthropic-ai/sdk", "@supabase/supabase-js"],
};

export default nextConfig;
