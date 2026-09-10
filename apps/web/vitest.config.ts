import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * The only thing this file exists for: teach vitest the `@/` alias that
 * tsconfig and Next already understand.
 *
 * Tests import src modules by relative path, so nothing needed it until a
 * tested file imported another src file by alias — middleware.ts pulling in
 * `@/lib/auth-user`. Before this, the middleware suite passed only because
 * every `@/` import it reached happened to be replaced by `vi.mock`, which
 * matches on the raw specifier; the first unmocked one failed to resolve and
 * took all seven cases down with it.
 */
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
});
