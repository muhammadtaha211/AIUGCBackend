import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Core is shipped as TypeScript source ("./src/index.ts" exports) — Next compiles it.
  // From @aiugc/remotion only the pure "./text-fit" subpath is imported.
  transpilePackages: ["@aiugc/core", "@aiugc/remotion"],
  // Native/dynamic-require packages stay as runtime node_modules requires.
  serverExternalPackages: ["postgres", "pino", "@anthropic-ai/sdk", "@supabase/supabase-js"],
  // The Service C generate route reads prompts/text_block/v<N>.md at request
  // time on a computed path, which the file tracer cannot see — apps/web's
  // copy routes ENOENT'd on Vercel without exactly this
  // (docs/vault/defects/computed-path-reads-are-invisible-to-vercel-tracing.md).
  outputFileTracingRoot: path.join(__dirname, "../.."),
  outputFileTracingIncludes: {
    "/api/**": ["../../prompts/**/*", "../../pnpm-workspace.yaml"],
  },
};

export default nextConfig;
