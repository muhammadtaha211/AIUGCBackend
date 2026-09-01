import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { getBundle } from "../src/render";

/**
 * Two production incidents, one memoized bundle:
 *
 * 1. Without an outDir, @remotion/bundler mkdtemps under os.tmpdir(), where
 *    temp janitors delete it (the worker box's @daily cron killed a live
 *    worker's bundle once the process outlived 12h —
 *    docs/vault/defects/tmp-cron-deletes-live-worker-bundle.md) and where
 *    nothing else ever cleaned it up (one leaked ~30-160MB dir per process —
 *    docs/vault/defects/remotion-temp-dirs-are-never-cleaned-up.md).
 * 2. Pre-fix, a deleted bundle dir failed EVERY subsequent render in the
 *    process — the memoized promise kept resolving to the dead path.
 *
 * Mocked: this must stay a keyless, instant check. The mock materializes each
 * bundle in the test's own scratch dir so the real .work location is never
 * touched (a live worker on this machine may be serving from it).
 */

const { bundleMock } = vi.hoisted(() => ({
  bundleMock: vi.fn<(args: { entryPoint: string; outDir?: string }) => Promise<string>>(),
}));
vi.mock("@remotion/bundler", () => ({ bundle: bundleMock }));

const scratch = mkdtempSync(path.join(tmpdir(), "aiugc-bundle-heal-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

bundleMock.mockImplementation(async () => {
  const dir = path.join(scratch, `bundle-${bundleMock.mock.calls.length}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "index.html"), "");
  return dir;
});

describe("getBundle", () => {
  it("passes a repo-owned outDir, never os.tmpdir()", async () => {
    await getBundle();
    const args = bundleMock.mock.calls[0]![0];
    expect(args.outDir, "bundle() called without outDir falls back to os.tmpdir()").toBeDefined();
    expect(args.outDir!.endsWith(path.join(".work", "remotion-bundle"))).toBe(true);
    expect(path.resolve(args.outDir!).startsWith(path.resolve(tmpdir()))).toBe(false);
  });

  it("memoizes while the bundle exists, re-bundles once it is deleted", async () => {
    const first = await getBundle();
    expect(await getBundle()).toBe(first);
    expect(bundleMock).toHaveBeenCalledTimes(1);

    rmSync(first, { recursive: true, force: true });
    const healed = await getBundle();
    expect(bundleMock).toHaveBeenCalledTimes(2);
    expect(healed).not.toBe(first);
    expect(existsSync(path.join(healed, "index.html"))).toBe(true);

    // healed result is memoized again — no bundle-per-render regression
    expect(await getBundle()).toBe(healed);
    expect(bundleMock).toHaveBeenCalledTimes(2);
  });
});
