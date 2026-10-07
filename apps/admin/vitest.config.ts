import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * The only thing this file exists for: teach vitest the `@/` alias that
 * tsconfig and Next already understand — the same file apps/web carries.
 *
 * The admin tests imported src by relative path only until the Service C
 * access test (test/text-blocks-access.test.ts) drove the route handlers
 * themselves, which import `@/lib/api` and `@/lib/text-blocks`.
 */
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
});
