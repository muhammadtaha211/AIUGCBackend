import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Teaches vitest the `@/` alias that tsconfig and Next already understand
 * (and, below, Next's JSX runtime).
 *
 * Tests import src modules by relative path, so nothing needed it until a
 * tested file imported another src file by alias — middleware.ts pulling in
 * `@/lib/auth-user`. Before this, the middleware suite passed only because
 * every `@/` import it reached happened to be replaced by `vi.mock`, which
 * matches on the raw specifier; the first unmocked one failed to resolve and
 * took all seven cases down with it.
 */
export default defineConfig({
  // The automatic JSX runtime, as Next compiles it: a test that calls a server
  // component (the social-connect suite walks the tree a page returns) would
  // otherwise hit esbuild's classic `React.createElement` with no React in scope.
  esbuild: { jsx: "automatic" },
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
});
